export declare class DshChatLocalService {
  constructor(ctx: any, config?: any);
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
   * Human-only: record a `relationship.intervention` that opens a new counting
   * window for the targets it names. Refused unless `appliedBy` is exactly
   * "human", and refused while a member of the room holds an active group-chat
   * turn. The counters as they stood before the intervention are recorded in the
   * event.
   */
  relationshipIntervention(roomId: string, input: any): Promise<any>;
  /**
   * Human-only: record the `run.manifest` that fixes one run's arm, models,
   * state version, start tick and injection config hash. Refused under the same
   * rules as `relationshipIntervention`.
   */
  startRun(roomId: string, input: any): Promise<any>;
  /**
   * Wait until the audit appends this service already owes have reached the log,
   * then report the log's health. It joins only work already issued: it never
   * waits for a turn to end, appends nothing of its own, and is a read.
   */
  settledAudit(): Promise<{ appended: number; failed: number; lastError: any; droppedCount: number; dropped: any[] }>;
  eventsFor(roomId: string): Promise<any[]>;
  logHealth(): { appended: number; failed: number; lastError: any; droppedCount: number; dropped: any[] };
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
  restoreFromSnapshot(snapshot: any, input?: any): Promise<any>;
  observeSessionEvent(sessionId: string, event: any): Promise<void>;
  close(): Promise<void>;
}
