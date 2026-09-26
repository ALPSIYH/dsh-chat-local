/** Public DSH integration boundaries; no preset or private registry mutation. */
export const PERSON_CONTEXT_NAME = "dsh-chat-local:person";
const STATUS_LIMIT = 512;
const CONTEXT_MESSAGES = Object.freeze({
  available: "DSH 允許原生會話帶入人格與個人記憶；這是上下文能力檢查，不代表模型已採用內容。",
  suppressed: "目前 DSH 預設停用原生會話的執行期上下文，因此不會自動帶入人格與個人記憶。群聊投遞與 chat_identity／chat_recall 仍可用；若要原生會話自動延續，請明確選擇啟用執行期上下文的 DSH 預設。",
  unavailable: "DSH 執行期上下文服務目前不可用；原生會話不會自動帶入人格與個人記憶。群聊投遞與本人記憶工具仍可用。",
  not_observed: "尚未觀察此會話的 DSH 提示組裝，不能確認原生會話是否自動帶入人格與個人記憶。"
});
const getService = (ctx, name) => ctx?.get?.(name) ?? ctx?.[name];

/** Only the reserved bridge format can identify a group delivery. */
export function groupDeliveryMarkers(message) {
  const text = (message?.content ?? []).filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text).join("\n");
  return [...text.matchAll(/\[dsh-bridge\s+dsh-chat-local-room\s+message\s+([^\s\]]+)\s+from\s+room:([^\s\]]+)\]/gu)]
    .map(match => ({ deliveryId: match[1], roomId: match[2] }));
}

/** Owns bounded capability observations and reversible per-turn tool presentation. */
export class NativeHostCompatibility {
  constructor(ctx) {
    this.ctx = ctx;
    this.contextMounted = false;
    this.turnHooksMounted = false;
    this.contextObservations = new Map();
    this.turns = new Map();
  }
  contextService(mounted) {
    this.contextMounted = mounted;
    if (!mounted) this.contextObservations.clear();
  }
  observeContext(sessionId, enabled) {
    const id = String(sessionId);
    this.contextObservations.delete(id);
    this.contextObservations.set(id, { state: enabled ? "available" : "suppressed", observedAt: Date.now() });
    while (this.contextObservations.size > STATUS_LIMIT) this.contextObservations.delete(this.contextObservations.keys().next().value);
  }
  contextStatus(sessionId) {
    const observation = this.contextObservations.get(String(sessionId));
    const state = observation?.state ?? (this.contextMounted ? "not_observed" : "unavailable");
    return { state, message: CONTEXT_MESSAGES[state], ...(observation ? { observedAt: observation.observedAt } : {}) };
  }
  health() {
    const states = { available: 0, suppressed: 0 };
    for (const value of this.contextObservations.values()) states[value.state]++;
    return { scope: "last-observed-host-assembly-this-process", serviceAvailable: this.contextMounted,
      trackedSessions: this.contextObservations.size, trackingLimit: STATUS_LIMIT, ...states };
  }
  assertDeliverySupported(agent) {
    if (!agent || getService(this.ctx, "tools")?.modeFor?.(agent) !== "ptc") return;
    if (!this.turnHooksMounted || typeof agent.ctx?.tools?.presentAs !== "function") {
      throw new Error("此 DSH 無法為 PTC 會話提供受限群聊所需的原生唯讀工具介面；未投遞任務。請在原生 DSH 明確改用非 PTC 預設後重試。");
    }
  }
  claimRestrictedTurn(agent, turn, captureId) {
    const id = String(agent.session.id);
    const previous = this.turns.get(id);
    if (previous?.agent === agent && previous.turn === turn) return;
    if (previous) this.release(id);
    const tools = getService(this.ctx, "tools");
    if (tools?.modeFor?.(agent) !== "ptc") return;
    const entry = { agent, turn, captureId };
    this.turns.set(id, entry);
    try {
      this.assertDeliverySupported(agent);
      // The Host preset's standing scope remains unchanged. The exact Agent
      // scope temporarily selects native presentation for this owned turn.
      entry.dispose = agent.ctx.tools.presentAs("native");
      if (tools.modeFor(agent) !== "native") throw new Error("DSH 未採用本回合的原生工具介面");
    } catch (error) {
      entry.error = `無法為受限群聊準備原生唯讀工具介面：${error.message}。本回合未執行工具；請改用非 PTC 預設後重試。`;
      try { entry.dispose?.(); } finally { entry.dispose = undefined; }
      try { agent.cancel?.({ kind: "hook", reason: entry.error }, { keepInbox: true }); } catch { /* assembly also fails closed */ }
    }
  }
  assertPromptReady(agent) {
    const entry = this.turns.get(String(agent?.session?.id));
    if (entry && entry.agent === agent && entry.error) throw new Error(entry.error);
  }
  sessionEvent(sessionId, event) {
    const entry = this.turns.get(String(sessionId));
    if (!entry) return;
    if (event?.type === "turn/end" && entry.turn === event.data?.turn
      || event?.type === "turn/start" && entry.turn !== event.data?.turn) this.release(String(sessionId));
  }
  finishCapture(capture) {
    const id = String(capture.sessionId);
    if (this.turns.get(id)?.captureId === capture.id) this.release(id);
  }
  agentDisposed(agent) {
    const id = String(agent?.session?.id);
    if (this.turns.get(id)?.agent === agent) this.release(id);
    this.contextObservations.delete(id);
  }
  release(id) {
    const entry = this.turns.get(id);
    this.turns.delete(id);
    entry?.dispose?.();
  }
  close() {
    for (const id of this.turns.keys()) this.release(id);
    this.contextService(false);
    this.turnHooksMounted = false;
  }
}
