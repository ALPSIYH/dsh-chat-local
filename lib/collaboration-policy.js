import { createHash } from "node:crypto";

export const MESSAGE_PURPOSES = new Set(["notify", "request", "correction", "objection", "discussion", "status"]);
export const collaborationEnabled = room => room.collaboration?.version === 1 && room.collaboration.strategy !== "legacy";
export const stableFingerprint = value => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
const closed = new Set(["done", "cancelled", "archived", "paused"]);

export function normalizeCollaboration(input, { fresh = false } = {}) {
  if (input?.version !== undefined && input.version !== 1) throw new Error("unsupported collaboration version");
  const strategy = input?.strategy ?? (fresh ? "work" : "legacy");
  if (!["work", "discussion", "legacy"].includes(strategy)) throw new Error("unsupported collaboration strategy");
  const budget = input?.budget ?? {};
  for (const [key, value] of Object.entries(budget)) {
    if (!["maxExecutions", "maxPerMember", "integrationReserve", "reviewReserve"].includes(key) || !Number.isSafeInteger(value) || value < (key.includes("Reserve") ? 0 : 1) || value > 1000) throw new Error(`invalid collaboration budget: ${key}`);
  }
  return { version: 1, strategy, revision: Math.max(1, Number(input?.revision) || 1), coordinatorSessionId: input?.coordinatorSessionId ?? null,
    budget: { ...budget }, requests: structuredClone(input?.requests ?? []), budgetAccounts: structuredClone(input?.budgetAccounts ?? []), unreviewed: structuredClone(input?.unreviewed ?? []),
    ...(input?.activeBudgetId ? { activeBudgetId: input.activeBudgetId } : {}) };
}

export function integrationWork(room) {
  return room.ledger.findLast(entry => entry.kind === "task" && !closed.has(entry.status) && (entry.integration === true || entry.requiredWorkIds?.length));
}

export function responsibleMember(room, workId, { review = false, exclude } = {}) {
  const work = room.ledger.find(entry => entry.id === workId) ?? integrationWork(room);
  const ids = [review ? work?.reviewerSessionId : work?.ownerSessionId, room.collaboration?.coordinatorSessionId,
    ...room.members.map(member => member.sessionId)];
  return ids.map(id => room.members.find(member => member.sessionId === id)).find(member => member && member.sessionId !== exclude);
}

export function messagePurpose(message, room) {
  if (message.purpose !== undefined && !MESSAGE_PURPOSES.has(message.purpose)) throw new Error("unsupported message purpose");
  if (message.purpose) return message.purpose;
  if (message.correctsMessageId) return "correction";
  if (message.humanAction || message.authorKind === "human") return room.collaboration?.strategy === "discussion" ? "discussion" : "request";
  return "notify";
}

export function selectRecipients(room, message) {
  const purpose = messagePurpose(message, room);
  if (purpose === "notify") return [];
  const explicit = message.recipientSessionIds ?? (message.mentions ?? []).flatMap(ref => ref === "all" ? room.members.map(m => m.sessionId) : room.members.filter(m => ref === `session:${encodeURIComponent(m.sessionId)}` || ref === m.sessionId || ref === m.alias).map(m => m.sessionId));
  if (explicit.length) return room.members.filter(member => explicit.includes(member.sessionId) && member.sessionId !== message.author);
  if (purpose === "discussion") return room.members.filter(member => member.sessionId !== message.author);
  const target = responsibleMember(room, message.workId, { review: ["correction", "objection"].includes(purpose) && room.ledger.some(item => item.id === message.workId && item.status === "in_review"), exclude: message.author });
  return target ? [target] : [];
}

export function commonBlockerKey(entry) {
  if (!entry.blocker || entry.status !== "blocked") return null;
  const blocker = entry.blocker;
  return stableFingerprint({ kind: blocker.kind, summary: blocker.summary, nextStep: blocker.nextStep,
    filePaths: [...(blocker.filePaths ?? [])].sort(), entryIds: [...(blocker.entryIds ?? [])].sort() });
}

/** Reusable settings carry stable identity, never old transport or run state. */
export function collaborationDefaults(room) {
  const state=room.collaboration;
  if (!state) return undefined;
  const coordinator=room.members.find(member=>member.sessionId===state.coordinatorSessionId);
  return {strategy:state.strategy,budget:{...state.budget},coordinatorAgentId:coordinator?.agentId??null};
}

export function projectCollaborationDefaults(input, members) {
  const configuration=normalizeCollaboration({strategy:input?.strategy??"work",budget:input?.budget,
    coordinatorSessionId:input?.coordinatorSessionId??members.find(member=>member.agentId&&member.agentId===input?.coordinatorAgentId)?.sessionId??null},{fresh:true});
  if (configuration.coordinatorSessionId&&!members.some(member=>member.sessionId===configuration.coordinatorSessionId)) throw new Error("coordinator must be a current room member");
  return configuration;
}
