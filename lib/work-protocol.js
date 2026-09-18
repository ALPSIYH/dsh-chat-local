// Shared by the host and browser: a label change is not execution or recovery.
export function createWorkProtocol() {
  // The ledger's closed-status vocabulary, defined inside the factory rather
  // than at module scope because `scripts/build-client.mjs` stringifies this
  // function into the browser bundle, where a module-level reference would be
  // unresolved. This is the vocabulary's only definition in the repository:
  // the host export below hands the same set to `room-store.js` (ledger
  // lifecycle) and `relationship.js` (unresolved disagreements), so the two can
  // no longer drift apart (R43).
  const closedStatuses = new Set(["done", "decided", "resolved", "archived", "cancelled", "paused"]);
  const closed = status => closedStatuses.has(status);
  const pending = handoff => ["queued", "sending", "waiting_report"].includes(handoff?.state);
  const needsUser = (entry, members) => {
    if (["archived","cancelled","paused"].includes(entry.status)) return false;
    if (["failed", "interrupted", "needs_report", "no_recipient"].includes(entry.handoff?.state)) return true;
    if (closed(entry.status)) return false;
    if ([entry.ownerSessionId, entry.reviewerSessionId].some(id=>id&&!members.has(id))) return true;
    if (entry.kind === "task") return !entry.ownerSessionId || entry.status === "in_review"&&!entry.reviewerSessionId || entry.status === "blocked"&&!pending(entry.handoff);
    return entry.status === "proposed" || entry.kind === "dispute"&&entry.status === "open";
  };
  const related = (entry, entries) => entries.filter(item=>item.id!==entry.id&&(entry.relatedEntryIds?.includes(item.id)||item.relatedEntryIds?.includes(entry.id)||entry.blocker?.entryIds?.includes(item.id)));
  const kindLabel = kind => ({file:"材料读取",decision:"等待决定",permission:"工具权限",dependency:"前置任务",external:"外部条件",other:"待核实原因"})[kind] || "待核实原因";
  const handoffLabel = state => ({queued:"已排队 · 当前讨论结束后通知",sending:"正在提交通知",waiting_report:"已通知 · 等待负责人实测回报",delivered:"已通知 · 不代表任务已完成",reported:"成员已更新台账",needs_report:"本轮结束但未回报处理结果",failed:"通知或执行失败 · 需要处理",interrupted:"通知已中断 · 可核对后重试",no_recipient:"没有有效接手人",cancelled:"事项已变化 · 旧通知已取消"})[state] || "尚未通知";
  const nextAction = entry => entry.kind === "decision" ? "通知关联负责人" : entry.status === "in_review" ? "通知验收人" : entry.status === "blocked" ? "通知负责人实测重试" : "通知负责人开始";
  return {closed,closedStatuses,pending,needsUser,related,kindLabel,handoffLabel,nextAction};
}
export const workProtocol = createWorkProtocol();

/**
 * The ledger statuses that mean "this entry is finished".
 *
 * One definition, two readers: `room-store.js` uses it for the ledger
 * lifecycle and `relationship.js` for `unresolvedDisagreements`, which would
 * otherwise carry a copy that could silently move out of step with the store's.
 * The set is shared, not copied, and is read-only by convention.
 */
export const CLOSED_LEDGER_STATUSES = workProtocol.closedStatuses;
