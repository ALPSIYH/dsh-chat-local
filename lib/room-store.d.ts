import type { DshChatLocalConfig } from "./index.js";

export interface AuditHealth {
  appended: number; failed: number; lastError: string | null; droppedCount: number; dropped: any[];
  pendingRecovery: number; pendingRooms: string[]; recoveredOperations: number;
  fullReads: number; viewHits: number; cacheRooms: number; cacheSourceBytes: number;
  cacheLimitBytes: number; cacheEvictions: number;
  storage: {
    usedBytes: number; freeBytes: number | null; reservedBytes: number; obligationBytes: number;
    obligations: number; hardBytes: number; softBytes: number; recoveryReserveBytes: number;
    minFreeBytes: number; recoveryDebtBytes: number; agentObservationLimitBytes: number;
    agentObservationBytes: Record<string, number>; agentAccountingError: string | null;
    pressure: "normal" | "soft" | "hard"; rejected: number; failed: number; lastError: string | null;
    checkedAt: number | null; active: boolean; ownership: "single-service-instance"; accounting: "logical-file-bytes";
  };
  memory: {
    reads: { unavailableSourceCount: number; scope: "last-verified-source-state-this-process" };
    coverage: { history: "live-events-only"; modalities: string[]; measuredSince: number;
      countersScope: "this-service-process"; preMountHistoryImported: false; limitations: string[];
      observedReceipts: number; failedReceipts: number; unboundEvents: number; ambiguousIdentityEvents: number;
      nonTextEvents: number; excludedRecallEvents: number };
    index: { sources: number; agents: number; cards: number; leaves: number; accountedBytes: number;
      maxIndexBytes: number; maxAgentIndexBytes: number; evictedSources: number;
      policyHistoryIncomplete: boolean; [key: string]: number | string | boolean };
    policy: { version: number; consolidation: boolean; decay: boolean; halfLifeDays: number;
      maxRecallBytes: number; maxIndexBytes: number; maxAgentIndexBytes: number; maxCandidateCount: number };
    maintenance: { runs: number; failures: number; lastError: string | null; queuedAgents: number; active: boolean };
  };
  journal: { pendingOperations: number; recoveredOperations: number; checkpointPending: boolean;
    lastError: string | null; syncError: string | null };
}

export declare class DshChatLocalService {
  constructor(ctx: any, config?: DshChatLocalConfig);
  workspace: {
    list(): Promise<any>;
    configuration(groupId?: string): Promise<any>;
    openDraft(input?: any): Promise<any>;
    saveDraft(id: string, input: any): Promise<any>;
    discardDraft(id: string, expectedRevision: number): Promise<any>;
    saveRoster(input: any): Promise<any>;
    createGroup(input: any): Promise<any>;
    startDraft(id: string, input: any): Promise<any>;
  };
  listGroups(): Promise<any[]>;
  groupConfiguration(groupId: string): Promise<any>;
  groupActivity(groupId: string): Promise<any>;
  setGroupLifecycle(groupId: string, input: any): Promise<any>;
  createConversation(groupId: string, input?: any): Promise<any>;
  saveGroupDefaults(roomId: string, input?: any): Promise<any>;
  prepareMember(roomId: string, sessionId: string): Promise<any>;
  selectMemberModel(roomId: string, sessionId: string, selection: any): Promise<any>;
  participantConfiguration(roomId: string): Promise<any>;
  updateParticipants(roomId: string, input: any): Promise<any>;
  prepareLedgerManagement(roomId: string, input: any, sessionId?: string): Promise<any>;
  commitLedgerManagement(roomId: string, batchId: string, input?: any): Promise<any>;
  triageLedgerEntry(roomId: string, entryId: string, input: any): Promise<any>;
  deliverSavedMessage(roomId: string, operationId: string): Promise<any>;
  listRooms(): Promise<any[]>;
  listDeletedRooms(): Promise<any[]>;
  messages(roomId: string, limit?: number): Promise<any[]>;
  messageContext(roomId: string, messageId: string, radius?: number): Promise<any[]>;
  searchMessages(roomId: string, input?: any): Promise<any[]>;
  relationships(roomId: string): Promise<Record<string, Record<string, any>>>;
  appraisals(roomId: string): Promise<Record<string, Record<string, any>>>;
  relationshipRow(roomId: string, sessionId: string): Promise<any>;
  appraise(roomId: string, sessionId: string, input: any): Promise<any>;
  /**
   * Refuses any call that is not the human's own: record a
   * `relationship.intervention` that opens a new counting window for the targets
   * it names. Refused unless `appliedBy` is exactly "human", and refused while a
   * member of the room holds an active group-chat turn. The counters as they
   * stood before the intervention are recorded in the event.
   */
  relationshipIntervention(roomId: string, input: { action: "set" | "clear" | "seed"; appliedBy: "human"; mechanism: string; observerId?: string; targetId?: string; counters?: Record<string, number> | null; memoryScope?: "counters" | "all"; note?: string | null }): Promise<any>;
  /**
   * Human-only, under the same rules as `relationshipIntervention`: record the
   * `run.manifest` that fixes one run's arm, models, state version, start tick
   * and injection config hash.
   */
  startRun(roomId: string, input: any): Promise<any>;
  /**
   * Wait until the audit appends this service already owes have reached the log,
   * then report the log's health. It joins only work already issued: it never
   * waits for a turn to end, appends nothing of its own, and is a read.
   */
  settledAudit(): Promise<AuditHealth>;
  eventsFor(roomId: string): Promise<any[]>;
  logHealth(): AuditHealth;
  stateVersion(): number;
  resolveRoom(reference: string): Promise<any>;
  createRoom(input: any): Promise<any>;
  setRoomAutoDeliver(roomId: string, enabled: boolean): Promise<any>;
  setRoomDetails(roomId: string, input: any): Promise<any>;
  setRoomProfile(roomId: string, input: any): Promise<any>;
  restoreCharter(roomId: string, input: any): Promise<any>;
  dismissCharterProposal(roomId: string, proposalId: string): Promise<any>;
  proposeCharter(roomId: string, sessionId: string, input: any): Promise<any>;
  reviewCharter(roomId: string, sessionId: string, input: any): Promise<any>;
  roomMemory(roomId: string, sessionId?: string): Promise<any>;
  /** Own identity is resolved from the executing session; room only disambiguates membership. */
  agentIdentity(sessionId: string, roomId?: string): Promise<any>;
  /** Optional native system-prompt context, absent for unbound or group-turn sessions. */
  nativeAgentContext(sessionId: string): Promise<string | null>;
  /** Read only personally observed sources bound to this identity. */
  agentMemory(sessionId: string, input?: { roomId?: string; query?: string; limit?: number; mode?: "default" | "explicit" }): Promise<any>;
  /** Own lifecycle edits require current personally observed evidence and an idempotency key. */
  updatePersonalMemory(sessionId: string, input: { roomId?: string; action: "pin" | "unpin" | "suppress" | "restore" | "belief" | "revoke_belief"; operationId: string; sourceRoomId?: string; evidenceId?: string; claim?: string; evidence?: { sourceRoomId: string; evidenceId: string }[]; supersedes?: string; beliefId?: string }): Promise<any>;
  /** Human storage operation; not exposed as an Agent tool. */
  maintainMemoryStorage(input: { sourceRoomId: string; action: "archive" | "thaw" | "cleanup" }): Promise<any>;
  deleteRoom(roomId: string, input: any): Promise<any>;
  restoreRoom(roomId: string, input: any): Promise<any>;
  stopRoom(roomId: string): Promise<any>;
  setRoomPolicy(roomId: string, input: any): Promise<any>;
  addMember(roomId: string, member: any, options?: any): Promise<any>;
  reorderMembers(roomId: string, sessionIds: string[], input?: any): Promise<any>;
  removeMember(roomId: string, sessionId: string): Promise<any>;
  listParticipants(roomId: string): Promise<any[]>;
  listLedger(roomId: string, input?: any): Promise<any[]>;
  createLedgerEntry(roomId: string, input: any): Promise<any>;
  updateLedgerEntry(roomId: string, entryId: string, patch: any, input: any): Promise<any>;
  inspectLedgerRecovery(roomId: string, entryId: string): Promise<any>;
  restoreLedgerEntry(roomId: string, entryId: string, input: any): Promise<any>;
  shareLedgerFile(roomId: string, entryId: string, input: any): Promise<any>;
  requestLedgerHandoff(roomId: string, entryId: string, input?: any): Promise<any>;
  operateWork(roomId: string, sessionId: string, input: any): Promise<any>;
  listArtifacts(roomId: string): Promise<any[]>;
  previewArtifact(roomId: string, input: any, options?: any): Promise<any>;
  readDocument(roomId: string, sessionId: string, input: any): Promise<any>;
  guardToolExecution(execution: any): string | undefined;
  send(input: any): Promise<any>;
  correctHumanMessage(roomId: string, messageId: string, input: any): Promise<any>;
  retryFailedDeliveries(roomId: string, messageId: string, sessionIds?: string[], options?: any): Promise<any>;
  exportRoom(roomId: string, format?: string): Promise<any>;
  saveRoomExport(roomId: string, format?: string): Promise<any>;
  snapshotRun(roomId: string, configHash?: string): Promise<any>;
  readRoomMemory(roomId: string): Promise<{ room: any; events: any[] }>;
  restoreFromSnapshot(snapshot: any, input?: any): Promise<any>;
  observeSessionEvent(sessionId: string, event: any): Promise<void>;
  close(): Promise<void>;
}
