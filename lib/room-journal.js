import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Replacement waiters may observe a promise, but never its resolver. */
class PendingReplacements {
  #entries = new Map();
  #resolvers = new WeakMap();

  get size() { return this.#entries.size; }
  get(roomId) { return this.#entries.get(roomId) ?? null; }

  open(roomId) {
    if (this.#entries.has(roomId)) throw new Error(`a log replace is already in flight for room ${String(roomId)}`);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const entry = Object.freeze({ roomId, promise });
    this.#resolvers.set(entry, resolve);
    this.#entries.set(roomId, entry);
    return entry;
  }

  release(entry) {
    const resolve = this.#resolvers.get(entry);
    if (!resolve) return;
    if (this.#entries.get(entry.roomId) === entry) this.#entries.delete(entry.roomId);
    this.#resolvers.delete(entry);
    resolve();
  }
}

/**
 * Owns the boundary between mutable room state, durable state, and its journal.
 * A state commit claims audits synchronously and publishes them only after its
 * write succeeds. A replacement is registered before any waiting audit resumes.
 * Checked facts reject a room object that restore has replaced. Snapshots read
 * durable state and retry if a commit crosses their state/log read boundary.
 *
 * This coordinates one service instance. State and event files are separate;
 * it does not claim cross-process locking or atomic recovery after a crash.
 */
export class RoomJournal {
  #path;
  #events;
  #currentRoom;
  #roomOperations = new Map();
  #commits = new Set();
  #flushes = new Set();
  #generation = 0;

  constructor({ path, events, currentRoom }) {
    this.#path = path;
    this.#events = events;
    this.#currentRoom = currentRoom;
    this.writeTail = Promise.resolve();
    this.auditFlush = Promise.resolve();
    this.pendingAudits = [];
    this.replacements = new PendingReplacements();
  }

  queue(room, build, stillValid, inSnapshot) {
    this.pendingAudits.push({ room, build, stillValid, ...(inSnapshot ? { inSnapshot } : {}) });
  }

  #beginCommit(state) {
    const snapshot = `${JSON.stringify(state, (key, value) => key === "savePending" ? undefined : value, 2)}\n`;
    const claimed = this.pendingAudits.splice(0);
    let audited;
    try {
      audited = claimed.map((entry) => ({ entry, inSnapshot: entry.inSnapshot ? entry.inSnapshot() : true }));
    } catch (error) {
      this.pendingAudits.unshift(...claimed);
      throw error;
    }
    this.#generation += 1;
    const write = this.writeTail.then(async () => {
      const parent = dirname(this.#path);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await chmod(parent, 0o700);
      const temporary = `${this.#path}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#path);
    });
    this.writeTail = write.catch(() => {});
    return { claimed, audited, write };
  }

  #track(promise, set) {
    set.add(promise);
    void promise.then(() => set.delete(promise), () => set.delete(promise));
    return promise;
  }

  commit(state) {
    const saving = this.#beginCommit(state);
    const completion = (async () => {
      try { await saving.write; }
      catch (error) { this.pendingAudits.unshift(...saving.claimed); throw error; }
      await this.#flush(saving.audited);
    })();
    return this.#track(completion, this.#commits);
  }

  #flush(audited) {
    const flush = (async () => {
      for (const { entry, inSnapshot } of audited) {
        if (!inSnapshot) continue;
        let pending = this.replacements.get(entry.room?.id);
        while (pending) {
          await pending.promise;
          pending = this.replacements.get(entry.room?.id);
        }
        if (this.#currentRoom(entry.room?.id) !== entry.room || !entry.stillValid()) continue;
        await this.record(entry.room, entry.build());
      }
    })();
    this.auditFlush = flush.catch(() => {});
    return this.#track(flush, this.#flushes);
  }

  /** Observational events remain best-effort; EventLog records dropped writes. */
  record(room, event) {
    if (!room) return Promise.resolve(null);
    return this.#events.append(room.id, { ...event, tick: room.tick ?? 0,
      provenance: { ...(event.provenance ?? {}), actorId: event.actor?.id ?? null, roomId: room.id } });
  }

  /**
   * A fact requiring live authority uses this shared commit boundary. Waiting,
   * room identity, authority validation and append registration are ordered;
   * there is no await between the final checks and registering the append.
   */
  async appendChecked(room, event, validate = () => {}) {
    let pending = this.replacements.get(room.id);
    while (pending) {
      await pending.promise;
      pending = this.replacements.get(room.id);
    }
    if (this.#currentRoom(room.id) !== room) throw new Error("room operation was superseded by a restored snapshot");
    validate();
    return this.record(room, event);
  }

  /** Serializes restores and coherent snapshots of the same room. */
  runRoom(roomId, operation) {
    const previous = this.#roomOperations.get(roomId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.catch(() => {});
    this.#roomOperations.set(roomId, tail);
    void tail.then(() => {
      if (this.#roomOperations.get(roomId) === tail) this.#roomOperations.delete(roomId);
    });
    return result;
  }

  /** Called just after the synchronous room swap, while holding runRoom. */
  async restore(room, events, state, { rollback, beforeReplace = () => {} }) {
    let replacement;
    let saving;
    try {
      replacement = this.replacements.open(room.id);
      saving = this.#beginCommit(state);
      await saving.write;
    } catch (error) {
      if (saving) this.pendingAudits.unshift(...saving.claimed);
      rollback();
      if (replacement) this.replacements.release(replacement);
      throw error;
    }
    const flushing = this.#flush(saving.audited);
    try {
      // Replacing must join writes, but never join the flush that awaits this
      // replacement. Register and release first: the wait graph stays acyclic.
      await this.writeTail;
      beforeReplace();
      const replaced = this.#events.replace(room.id, events);
      this.replacements.release(replacement);
      await flushing;
      await replaced;
    } finally {
      this.replacements.release(replacement);
    }
  }

  /** Joins complete state+audit work already published, not just the last write. */
  async settled() {
    for (;;) {
      const generation = this.#generation;
      const tail = this.writeTail;
      await tail;
      await Promise.allSettled([...this.#commits, ...this.#flushes]);
      await this.#events.drain();
      if (generation === this.#generation && tail === this.writeTail
        && this.#commits.size === 0 && this.#flushes.size === 0) return;
    }
  }

  /** Durable room and events from one stable commit generation. */
  readRoomMemory(roomId) {
    return this.runRoom(roomId, async () => {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        await this.settled();
        const generation = this.#generation;
        const state = JSON.parse(await readFile(this.#path, "utf8"));
        const events = await this.#events.read(roomId);
        if (generation !== this.#generation) continue;
        const room = state.rooms.find((item) => item.id === roomId);
        if (!room) throw new Error(`room ${roomId} does not exist in committed state`);
        return { room, events };
      }
      throw new Error("room changed continuously while reading its committed memory; retry the snapshot");
    });
  }
}
