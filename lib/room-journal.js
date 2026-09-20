import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { verifyChain } from "./event-log.js";

const pendingHash = pending => createHash("sha256").update(JSON.stringify(pending)).digest("hex");

/** Offline readers refuse an unfinished state outbox; they never recover it. */
export async function assertAuditSettled(path, roomId) {
  let info;
  try { info = await stat(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!info.isFile()) throw new Error("room state is not a regular file; audit status cannot be checked");
  const journal = JSON.parse(await readFile(path, "utf8"))._journal;
  if (journal === undefined) return;
  if (!journal || journal.version !== 1 || !Array.isArray(journal.pending)
    || journal.checksum !== pendingHash(journal.pending)) throw new Error("invalid audit recovery record; offline report refused");
  if (journal.pending.some(operation => roomId === undefined || operation.roomId === roomId)) {
    throw new Error("committed audit recovery is pending; restart the writing service on a working copy before offline evaluation");
  }
}

/** Replacement waiters may observe a promise, but never its resolver. */
class PendingReplacements {
  #entries = new Map();
  #resolvers = new WeakMap();

  get size() { return this.#entries.size; }
  get(roomId) { return this.#entries.get(roomId) ?? null; }
  waiting() { return [...this.#entries.values()].map(entry => entry.promise); }

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
 * State and its audit obligations are one atomic document. Publication may lag,
 * but every committed obligation survives process death until an idempotent
 * event append (or replacement) and a checkpoint acknowledge it. Callers never
 * reconstruct an event from current state during recovery.
 *
 * State writes/checkpoints share one queue; event queues remain per room. This
 * permits unrelated room publication without making restore wait on its own
 * gate. One service instance owns the state directory.
 */
export class RoomJournal {
  #path;
  #events;
  #currentRoom;
  #roomOperations = new Map();
  #restoreTail = Promise.resolve();
  #commits = new Set();
  #flushes = new Set();
  #unpublished = new Set();
  #entryOperations = new WeakMap();
  #pending = new Map();
  #publishing = new Map();
  #stateReady = new Map();
  #lastState;
  #diskPending = "[]";
  #generation = 0;
  #lastError = null;
  #syncError = null;
  #recovered = 0;
  #capacity;

  constructor({ path, events, currentRoom, capacity }) {
    this.#path = path;
    this.#capacity = capacity;
    this.#events = events;
    this.#currentRoom = currentRoom;
    this.writeTail = Promise.resolve();
    this.auditFlush = Promise.resolve();
    this.pendingAudits = [];
    this.replacements = new PendingReplacements();
  }

  health() {
    return { pendingOperations: this.#pending.size, recoveredOperations: this.#recovered,
      checkpointPending: this.#diskPending !== JSON.stringify([...this.#pending.values()]),
      lastError: this.#lastError, syncError: this.#syncError };
  }

  #input(room, event) {
    // Publish the same JSON value recovery will read, including undefined/null
    // normalization. Otherwise a retry of an already appended event conflicts.
    return JSON.parse(JSON.stringify({ ...event, tick: room.tick ?? 0,
      provenance: { ...(event.provenance ?? {}), actorId: event.actor?.id ?? null, roomId: room.id } }));
  }

  queue(room, build, stillValid, inSnapshot) {
    this.pendingAudits.push({ room, build, stillValid, ...(inSnapshot ? { inSnapshot } : {}) });
  }

  #capture(entry) {
    const eligible = (!entry.inSnapshot || entry.inSnapshot()) && entry.stillValid()
      && this.#currentRoom(entry.room?.id) === entry.room;
    if (!eligible) return { entry, operation: null };
    let operation = this.#entryOperations.get(entry);
    if (!operation) {
      operation = { id: randomUUID(), kind: "append", roomId: entry.room.id,
        event: this.#input(entry.room, entry.build()) };
      this.#entryOperations.set(entry, operation);
    }
    return { entry, operation };
  }

  async #write(state, pending, committed = () => {}, recovery = false) {
    const parent = dirname(this.#path);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    const temporary = `${this.#path}.${crypto.randomUUID()}.tmp`;
    const document = { ...state };
    delete document._journal;
    if (pending.length) document._journal = { version: 1, pending, checksum: pendingHash(pending) };
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    const writing = async (reservation) => {
    try {
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await chmod(temporary, 0o600);
      const file = await open(temporary, "r");
      try { await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.#path);
      // After rename, the new document is authoritative even if syncing its
      // directory fails. Never let a caller roll back an already applied state.
      this.#lastState = state;
      this.#diskPending = JSON.stringify(pending);
      // Readers and direct observations must see the newly authoritative
      // obligations before directory sync yields to any other operation.
      reservation?.commitObligations();
      committed();
      try {
        const directory = await open(parent, "r");
        try { await directory.sync(); } finally { await directory.close(); }
        this.#syncError = null;
      } catch (error) { this.#syncError = `state directory sync: ${error.code ?? error.message}`; }
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
    };
    return this.#capacity ? this.#capacity.run({peakBytes:Buffer.byteLength(serialized), obligations:pending, recovery}, writing) : writing();
  }

  #beginCommit(state, replacement) {
    // Serialize now, while the audit predicates see the same mutable state.
    const snapshot = JSON.parse(JSON.stringify(state, (key, value) => key === "savePending" ? undefined : value));
    delete snapshot._journal;
    const queued = this.pendingAudits.splice(0);
    const claimed = [...new Set([...this.#unpublished, ...queued])];
    let audited;
    try { audited = claimed.map(entry => this.#capture(entry)); }
    catch (error) { this.pendingAudits.unshift(...queued); throw error; }
    for (const entry of claimed) this.#unpublished.add(entry);
    this.#generation += 1;
    let publication = Promise.resolve();
    const write = this.writeTail.then(async () => {
      const pending = new Map(this.#pending);
      if (replacement) {
        // A committed restore explicitly supersedes this room's older history,
        // including unflushed obligations. Other rooms retain theirs.
        for (const [id, operation] of pending) if (operation.roomId === replacement.roomId) pending.delete(id);
        pending.set(replacement.id, replacement);
      }
      for (const { operation } of audited) {
        if (operation) pending.set(operation.id, operation);
      }
      await this.#write(snapshot, [...pending.values()], () => {
        // Appends can finish while the state write awaits I/O. A completed
        // entry may reappear in the outbox; replay remains idempotent.
        this.#pending = pending;
        for (const operation of pending.values()) {
          if (!this.#stateReady.has(operation.id)) {
            this.#stateReady.set(operation.id, write);
          }
        }
        for (const { entry } of audited) this.#finishAudit(entry);
        publication = this.#flush({ skipRoom: replacement?.roomId });
      });
    });
    this.writeTail = write.catch(() => {});
    void write.finally(() => {
      for (const [id, ready] of this.#stateReady) if (ready === write) this.#stateReady.delete(id);
    }).catch(() => {});
    return { claimed, audited, write, published: () => publication };
  }

  #track(promise, set) {
    set.add(promise);
    void promise.then(() => set.delete(promise), () => set.delete(promise));
    return promise;
  }

  #requeue(entries) {
    const queued = new Set(this.pendingAudits);
    this.pendingAudits.unshift(...entries.filter(entry => this.#unpublished.has(entry) && !queued.has(entry)));
  }

  #finishAudit(entry) {
    this.#unpublished.delete(entry);
    const index = this.pendingAudits.indexOf(entry);
    if (index !== -1) this.pendingAudits.splice(index, 1);
  }

  commit(state) {
    // The service installs a restored room before its first state write. Until
    // that restore commits or rolls back, another snapshot must not capture the
    // speculative room without the replacement that gives its log meaning.
    if (this.replacements.size) {
      const deferred = (async () => {
        while (this.replacements.size) await Promise.all(this.replacements.waiting());
        return this.commit(state);
      })();
      return this.#track(deferred, this.#commits);
    }
    const saving = this.#beginCommit(state);
    const completion = (async () => {
      try { await saving.write; }
      catch (error) { this.#requeue(saving.claimed); throw error; }
      await saving.published();
      await this.#flush();
      await this.#checkpoint();
    })();
    return this.#track(completion, this.#commits);
  }

  #publish(operation) {
    if (!this.#pending.has(operation.id)) return Promise.resolve(true);
    if (this.#publishing.has(operation.id)) return this.#publishing.get(operation.id);
    const publishing = (async () => {
      try {
        // The renamed outbox is visible immediately, but its facts cannot
        // reach a durable log before the state directory sync has completed.
        await this.#stateReady.get(operation.id);
        if (!this.#pending.has(operation.id)) return true;
        if (operation.kind === "replace") await this.#events.replace(operation.roomId, operation.events, operation.id, {recovery:true});
        else if (await this.#events.appendOnce(operation.roomId, operation.event, operation.id, {recovery:true}) === null) {
          throw new Error("event append was not acknowledged");
        }
        this.#pending.delete(operation.id);
        this.#capacity?.releaseObligation(operation.id);
        if (!this.#pending.size) this.#lastError = null;
        return true;
      } catch (error) {
        this.#lastError = `audit recovery pending: ${error.code ?? error.message}`;
        return false;
      }
    })();
    this.#publishing.set(operation.id, publishing);
    void publishing.finally(() => this.#publishing.delete(operation.id));
    return publishing;
  }

  #flush({ skipRoom } = {}) {
    const flush = (async () => {
      const failed = new Set();
      for (;;) {
        let progressed = false;
        const blocked = new Set(failed);
        for (const operation of [...this.#pending.values()]) {
          if (operation.roomId === skipRoom || blocked.has(operation.roomId)) continue;
          // Helping another room is safe; passing an unpublished predecessor
          // in this room is not, even when its first append has no intent yet.
          if (this.#publishing.has(operation.id)) { blocked.add(operation.roomId); continue; }
          let replacing = this.replacements.get(operation.roomId);
          while (replacing) { await replacing.promise; replacing = this.replacements.get(operation.roomId); }
          if (!this.#pending.has(operation.id)) continue;
          if (await this.#publish(operation)) progressed = true;
          else { blocked.add(operation.roomId); failed.add(operation.roomId); }
        }
        // Include obligations committed while this pass awaited publication.
        // Failed rooms stop until another save/restart retries their outbox.
        if (!progressed) break;
      }
    })();
    this.auditFlush = flush.catch(() => {});
    return this.#track(flush, this.#flushes);
  }

  #checkpoint() {
    const checkpoint = this.writeTail.then(async () => {
      const pending = [...this.#pending.values()];
      if (!this.#lastState || this.#diskPending === JSON.stringify(pending)) return;
      try { await this.#write(this.#lastState, pending, () => {}, true); }
      catch (error) { this.#lastError = `audit checkpoint pending: ${error.code ?? error.message}`; }
    });
    this.#generation += 1;
    this.writeTail = checkpoint.catch(() => {});
    return checkpoint;
  }

  /** Complete the exact committed outbox before exposing loaded state. */
  async recover(state) {
    const journal = state._journal;
    if (journal !== undefined && (!journal || journal.version !== 1 || !Array.isArray(journal.pending)
      || journal.checksum !== pendingHash(journal.pending))) {
      throw new Error("unsupported or invalid audit recovery record; state was not overwritten");
    }
    const operations = journal?.pending ?? [];
    const ids = new Set();
    for (const operation of operations) {
      if (!operation || typeof operation.id !== "string" || !operation.id || ids.has(operation.id)
        || typeof operation.roomId !== "string" || !operation.roomId || !state.rooms.some(room => room.id === operation.roomId)
        || !["append", "replace"].includes(operation.kind)
        || operation.kind === "append" && (!operation.event || typeof operation.event.type !== "string"
          || operation.event.provenance?.roomId !== operation.roomId)
        || operation.kind === "replace" && (!Array.isArray(operation.events) || !verifyChain(operation.events).ok)) {
        throw new Error("invalid audit recovery operation; state was not overwritten");
      }
      ids.add(operation.id);
    }
    this.#lastState = structuredClone(state);
    delete this.#lastState._journal;
    this.#diskPending = JSON.stringify(operations);
    this.#pending = new Map(operations.map(operation => [operation.id, operation]));
    await this.#capacity?.restoreObligations(operations);
    await this.#flush();
    if (this.#pending.size) throw new Error(`audit recovery incomplete: ${this.#pending.size} committed operations remain; ${this.#lastError}`);
    this.#recovered += operations.length;
    await this.#checkpoint();
  }

  /** Direct observations cannot overtake a committed, unpublished room fact. */
  record(room, event, validate = () => {}, operationId) {
    if (!room) return Promise.resolve(null);
    const input = this.#input(room, event);
    const publish = () => {
      if (this.#currentRoom(room.id) !== room) throw new Error("room operation was superseded by a restored snapshot");
      validate();
      return operationId === undefined ? this.#events.append(room.id, input)
        : this.#events.appendOnce(room.id, input, operationId);
    };
    if (!this.replacements.get(room.id) && ![...this.#pending.values()].some(operation => operation.roomId === room.id)) return publish();
    const writing = (async () => {
      let replacement = this.replacements.get(room.id);
      while (replacement) { await replacement.promise; replacement = this.replacements.get(room.id); }
      for (const operation of [...this.#pending.values()]) {
        if (operation.roomId === room.id && !await this.#publish(operation)) return null;
      }
      return publish();
    })();
    return this.#track(writing, this.#flushes);
  }

  async appendChecked(room, event, validate = () => {}, operationId) {
    let pending = this.replacements.get(room.id);
    while (pending) { await pending.promise; pending = this.replacements.get(room.id); }
    if (this.#currentRoom(room.id) !== room) throw new Error("room operation was superseded by a restored snapshot");
    return this.record(room, event, validate, operationId);
  }

  runRoom(roomId, operation) {
    const previous = this.#roomOperations.get(roomId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.catch(() => {});
    this.#roomOperations.set(roomId, tail);
    void tail.then(() => { if (this.#roomOperations.get(roomId) === tail) this.#roomOperations.delete(roomId); });
    return result;
  }

  /** Enter before installing a restored room in the shared mutable state. */
  runRestore(operation) {
    const result = this.#restoreTail.then(operation);
    this.#restoreTail = result.catch(() => {});
    return result;
  }

  /**
   * Commit one already-staged restore. Concurrent callers must stage their
   * state changes inside runRestore; rejecting an uncoordinated second restore
   * is safer than capturing its speculative room in another state snapshot.
   */
  async restore(room, events, state, { rollback, beforeReplace = () => {} }) {
    const operation = { id: randomUUID(), kind: "replace", roomId: room.id, events: structuredClone(events) };
    let replacement, saving;
    try {
      if (this.replacements.size) throw new Error("concurrent snapshot restores must be staged inside runRestore");
      replacement = this.replacements.open(room.id);
      saving = this.#beginCommit(state, operation);
      await saving.write;
    } catch (error) {
      if (saving) this.#requeue(saving.claimed);
      rollback();
      if (replacement) this.replacements.release(replacement);
      throw error;
    }
    const flushing = this.#flush({ skipRoom: room.id });
    try {
      await this.writeTail;
      beforeReplace();
      if (!await this.#publish(operation)) throw new Error(`snapshot restore committed but audit recovery incomplete: ${this.#lastError}`);
    } finally { this.replacements.release(replacement); }
    await saving.published();
    await flushing;
    await this.#flush();
    await this.#checkpoint();
  }

  async settled() {
    for (;;) {
      const generation = this.#generation, tail = this.writeTail;
      await tail;
      await Promise.allSettled([...this.#commits, ...this.#flushes]);
      await this.#events.drain();
      if (generation === this.#generation && tail === this.writeTail && !this.#commits.size && !this.#flushes.size) return;
    }
  }

  async readEvents(roomId) {
    // A first tool may legitimately read its prompt receipt while the delivery
    // status save is still pending. Join the event queue, not every state save;
    // reject only committed obligations absent from the returned history.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      // Publication already issued may span several per-room appends. Joining
      // just EventLog.read can observe the gap between them. Do not join state
      // commits: the first tool can run while its delivery-state save is held.
      await Promise.allSettled([...this.#flushes]);
      const events = await this.#events.read(roomId);
      const published = new Set(events.map(event => event.provenance?.operationId));
      const missing = [...this.#pending.values()].some(operation => operation.roomId === roomId
        && (operation.kind === "replace" || !published.has(operation.id)));
      if (!missing) return events;
      if (this.#flushes.size) continue;
      throw new Error("committed audit recovery is incomplete; retry after repairing storage");
    }
    throw new Error("room audit changed continuously while reading; retry the read");
  }


  async readEventView(roomId, options = {}) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      await Promise.allSettled([...this.#flushes]);
      const view = await this.#events.readView(roomId, options);
      const obligations = [...this.#pending.values()].filter(operation => operation.roomId === roomId);
      if (!obligations.length) return view;
      const missing = obligations.some(operation => operation.kind === "replace")
        || !await this.#events.hasPublished(roomId, obligations.map(operation => operation.id), view.revision);
      if (!missing) return view;
      if (this.#flushes.size) continue;
      throw new Error("committed audit recovery is incomplete; retry after repairing storage");
    }
    throw new Error("room audit changed continuously while reading; retry the read");
  }

  readRoomMemory(roomId) {
    return this.runRoom(roomId, async () => {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        await this.settled();
        if ([...this.#pending.values()].some(operation => operation.roomId === roomId)) {
          throw new Error("committed audit recovery is incomplete; retry after repairing storage");
        }
        const generation = this.#generation;
        const state = JSON.parse(await readFile(this.#path, "utf8"));
        const events = await this.#events.read(roomId);
        if (generation !== this.#generation) continue;
        const room = state.rooms.find(item => item.id === roomId);
        if (!room) throw new Error(`room ${roomId} does not exist in committed state`);
        return { room, events };
      }
      throw new Error("room changed continuously while reading its committed memory; retry the snapshot");
    });
  }
}
