import { lstat, mkdir, readdir, readFile, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coldManifestPath, readColdLog, readColdManifest } from './cold-log.js';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
export const observationOwner = event => typeof event?.payload?.observerAgentId === 'string' ? event.payload.observerAgentId : null;
function bytes(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}
async function diskUsage(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  // Never follow a symlink out of the managed directory. Its own directory
  // entry is charged, while the owner of its target controls that target.
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(path)) total += await diskUsage(join(path, name));
  return total;
}
export function auditOperationPeak(operation) {
  // Intent and its atomic replacement coexist with the old log/anchor. A
  // replace additionally writes a full new log and its receipt document.
  const serialized = Buffer.byteLength(JSON.stringify(operation));
  return 4 * serialized + 8192;
}

/** One instance owns a state directory. All writers must share this instance.
 * Admissions and settlement run in one queue; in-flight write peaks remain
 * reserved while independent room I/O can proceed concurrently. Pending outbox obligations
 * reserve their future publication peak until acknowledged. No source is
 * automatically deleted. Quotas account for logical file bytes, not blocks.
 */
export class StorageCapacity {
  #directory; #tail = Promise.resolve(); #obligations = new Map();
  #used = 0; #free = null; #reserved = 0; #rejected = 0; #failed = 0; #lastError = null;
  #checkedAt = null; #recoveryDebt = 0; #active = false; #reservations = new Map(); #pendingWrites = new Set();
  #sources = new Map(); #agentUsage = new Map(); #agentError = null; #obligationOwners = new Map();
  constructor({ statePath, hardBytes = 2 * GiB, softBytes = GiB,
    recoveryReserveBytes = 128 * MiB, minFreeBytes = 16 * MiB, agentObservationBytes = 256 * MiB } = {}) {
    if (typeof statePath !== 'string' || !statePath) throw new TypeError('statePath is required');
    this.#directory = dirname(statePath);
    this.hardBytes = bytes(hardBytes, 'hardBytes');
    this.softBytes = bytes(softBytes, 'softBytes');
    this.recoveryReserveBytes = bytes(recoveryReserveBytes, 'recoveryReserveBytes');
    this.minFreeBytes = bytes(minFreeBytes, 'minFreeBytes');
    this.agentObservationBytes = bytes(agentObservationBytes, 'agentObservationBytes');
    if (softBytes > hardBytes || recoveryReserveBytes > hardBytes) throw new RangeError('softBytes and recoveryReserveBytes must not exceed hardBytes');
  }
  #enqueue(fn) { const result = this.#tail.then(fn); this.#tail = result.catch(() => {}); return result; }
  async #measure() {
    await mkdir(this.#directory, {recursive:true, mode:0o700});
    this.#used = await diskUsage(this.#directory);
    try { await this.#measureAgents(); this.#agentError = null; } catch(error) { this.#agentError=String(error.code ?? 'AGENT_QUOTA_ACCOUNTING_FAILED'); }
    const filesystem = await statfs(this.#directory);
    this.#free = filesystem.bavail * filesystem.bsize;
    this.#checkedAt = Date.now();
    this.#recoveryDebt = Math.max(0, this.#used - this.hardBytes);
  }
  async #sourceSignature(path) {
    const manifest=await readColdManifest(path), paths=[path,coldManifestPath(path)];
    if(manifest)paths.push(join(dirname(path),manifest.archive));
    const parts=[];
    for(const file of paths){
      try { const st=await lstat(file,{bigint:true}); if(!st.isFile())throw new Error('agent observation source must be a regular file'); parts.push(`${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`); }
      catch(error){if(error.code!=='ENOENT')throw error;parts.push('absent');}
    }
    return parts.join('|');
  }
  #sumAgents() {
    this.#agentUsage=new Map();
    for(const source of this.#sources.values())for(const [id,size] of source.agents)this.#agentUsage.set(id,(this.#agentUsage.get(id)??0)+size);
  }
  async #measureAgents() {
    const directory=join(this.#directory,'events');let names;
    try { names=await readdir(directory); } catch(error) { if(error.code==='ENOENT'){this.#sources.clear();this.#sumAgents();return;}throw error; }
    const present=new Set();
    for(const name of names.filter(name=>name.endsWith('.jsonl'))){
      const roomId=name.slice(0,-6), path=join(directory,name), signature=await this.#sourceSignature(path);present.add(roomId);
      if(this.#sources.get(roomId)?.signature===signature)continue;
      const cold=await readColdLog(path), text=cold ? cold.bytes.toString('utf8') : await readFile(path,'utf8'), agents=new Map();
      for(const line of text.split('\n')) {
        if(!line.trim())continue;
        const event=JSON.parse(line), owner=observationOwner(event);
        if(owner)agents.set(owner,(agents.get(owner)??0)+Buffer.byteLength(line)+1);
      }
      if(signature!==await this.#sourceSignature(path))throw new Error('agent observation source changed while accounting');
      this.#sources.set(roomId,{signature,agents});
    }
    for(const id of this.#sources.keys())if(!present.has(id))this.#sources.delete(id);
    this.#sumAgents();
  }
  /** Called inside this governor's write transaction after a known append. It
   * advances only accounting metadata; cold/replaced/external sources rebuild. */
  async noteAppend(roomId,event,lineBytes) {
    const current=this.#sources.get(roomId), agents=new Map(current?.agents ?? []), owner=observationOwner(event);
    if(owner)agents.set(owner,(agents.get(owner)??0)+lineBytes);
    const path=join(this.#directory,'events',`${roomId}.jsonl`);
    this.#sources.set(roomId,{signature:await this.#sourceSignature(path),agents});this.#sumAgents();
  }
  #owners(operations) {
    return new Map(operations.filter(op=>op.kind==='append' && observationOwner(op.event))
      .map(op=>[op.id,{agentId:observationOwner(op.event),bytes:Buffer.byteLength(JSON.stringify(op.event))+1024}]));
  }

  health() {
    const obligationBytes = [...this.#obligations.values()].reduce((sum, n) => sum + n, 0);
    return {usedBytes:this.#used, freeBytes:this.#free, reservedBytes:this.#reserved,
      obligationBytes, obligations:this.#obligations.size, hardBytes:this.hardBytes,
      softBytes:this.softBytes, recoveryReserveBytes:this.recoveryReserveBytes,
      minFreeBytes:this.minFreeBytes, recoveryDebtBytes:this.#recoveryDebt,
      agentObservationLimitBytes:this.agentObservationBytes, agentObservationBytes:Object.fromEntries(this.#agentUsage), agentAccountingError:this.#agentError,
      pressure: this.#lastError || this.#agentError || this.#used + obligationBytes > this.hardBytes - this.recoveryReserveBytes ? 'hard'
        : this.#used + obligationBytes >= this.softBytes ? 'soft' : 'normal',
      rejected:this.#rejected, failed:this.#failed, lastError:this.#lastError,
      checkedAt:this.#checkedAt, active:this.#active, ownership:'single-service-instance', accounting:'logical-file-bytes'};
  }
  refresh() { return this.#enqueue(async () => { await this.#measure(); return this.health(); }); }
  restoreObligations(operations) {
    return this.#enqueue(() => { this.#obligations = new Map(operations.map(op => [op.id, auditOperationPeak(op)])); this.#obligationOwners=this.#owners(operations); });
  }
  releaseObligation(id) { this.#obligations.delete(id); this.#obligationOwners.delete(id); }
  run({peakBytes, recovery = false, claimId, obligations, agentId, agentBytes = 0} = {}, operation) {
    bytes(peakBytes, 'peakBytes'); bytes(agentBytes, 'agentBytes');
    if (typeof operation !== 'function') throw new TypeError('storage operation is required');
    const ticket = Symbol('storage-reservation');
    const admitted = this.#enqueue(async () => {
      await this.#measure();
      const desired = obligations === undefined ? this.#obligations
        : new Map(obligations.map(op => [op.id, auditOperationPeak(op)]));
      const owners = obligations === undefined ? this.#obligationOwners : this.#owners(obligations);
      // Existing committed observations are already owed. An accounting
      // failure fences new Agent charges, while unrelated state/outbox saves
      // can still persist under the global byte limit and expose that failure.
      const chargedAgents = new Set();
      if (agentId && agentBytes > 0) chargedAgents.add(agentId);
      for (const [id, owner] of owners) {
        const previous = this.#obligationOwners.get(id);
        if (id !== claimId && (!previous || previous.agentId !== owner.agentId || owner.bytes > previous.bytes)) chargedAgents.add(owner.agentId);
      }
      const wantedAgents = new Map();
      for (const [id, owner] of owners) if (id !== claimId) wantedAgents.set(owner.agentId, (wantedAgents.get(owner.agentId) ?? 0) + owner.bytes);
      for (const pending of this.#reservations.values()) if (pending.agentId) wantedAgents.set(pending.agentId, (wantedAgents.get(pending.agentId) ?? 0) + pending.agentBytes);
      if (agentId) wantedAgents.set(agentId, (wantedAgents.get(agentId) ?? 0) + agentBytes);
      if (!recovery && chargedAgents.size && (this.#agentError || [...chargedAgents].some(id => (this.#agentUsage.get(id) ?? 0) + (wantedAgents.get(id) ?? 0) > this.agentObservationBytes))) {
        this.#rejected += 1; this.#lastError = this.#agentError ?? 'AGENT_STORAGE_CAPACITY';
        throw Object.assign(new Error('agent observation capacity exhausted or cannot be verified'), {code:this.#lastError});
      }
      const debt = [...desired].reduce((sum, [id,n]) => sum + (id === claimId ? 0 : n), 0);
      const existingDebt = [...this.#obligations.values()].reduce((sum, n) => sum+n, 0);
      const outstanding = [...this.#reservations.values()].reduce((sum, value) => sum + value.peakBytes + value.additionalDebt, 0);
      // Existing over-quota data remains readable. Only finishing already
      // committed work may borrow the bounded recovery reserve above its size.
      const ceiling = recovery ? Math.max(this.hardBytes, this.#used + this.recoveryReserveBytes)
        : this.hardBytes - this.recoveryReserveBytes;
      if (this.#used + outstanding + debt + peakBytes > ceiling
        || this.#free - outstanding - peakBytes < (recovery ? 0 : this.minFreeBytes)) {
        this.#rejected += 1; this.#lastError = 'STORAGE_CAPACITY';
        throw Object.assign(new Error('storage capacity exhausted; new work is paused until capacity is available'), {code:'STORAGE_CAPACITY'});
      }
      const reservation = {peakBytes, additionalDebt:Math.max(0,debt-existingDebt), agentId, agentBytes};
      this.#reservations.set(ticket,reservation); this.#updateReservations();
      return {commitObligations: () => {
        this.#obligations = desired; this.#obligationOwners = owners;
        reservation.additionalDebt = 0; this.#updateReservations();
      }};
    });
    // Only admission and settlement are serialized. Holding the quota queue
    // across I/O would deadlock independent-room restores behind a suspended
    // append. All in-flight peaks remain reserved while their I/O proceeds.
    const completion = admitted.then(async reservation => {
      let result, failure;
      try { result = await operation(reservation); }
      catch (error) { failure = error; }
      await this.#enqueue(async () => {
        this.#reservations.delete(ticket); this.#updateReservations();
        if (failure) { this.#failed += 1; this.#lastError = String(failure.code ?? 'STORAGE_WRITE_FAILED'); }
        else this.#lastError = null;
        await this.#measure().catch(error => { this.#lastError ??= String(error.code ?? 'STORAGE_ACCOUNTING_FAILED'); });
      });
      if (failure) throw failure;
      return result;
    });
    this.#pendingWrites.add(completion);
    void completion.then(() => this.#pendingWrites.delete(completion), () => this.#pendingWrites.delete(completion));
    return completion;
  }
  /** Host must stop new producers first. Join admitted, rejected and still
   * queued writes, including persona and maintenance writes outside event tails. */
  async drain() {
    for (;;) {
      const queued = this.#tail;
      await Promise.allSettled([...this.#pendingWrites]);
      await queued;
      if (!this.#pendingWrites.size && queued === this.#tail) return;
    }
  }
  #updateReservations() {
    this.#reserved = [...this.#reservations.values()].reduce((sum, value) => sum + value.peakBytes + value.additionalDebt, 0);
    this.#active = this.#reservations.size > 0;
  }
}
