import { randomUUID } from "node:crypto";
import { integrationWork, responsibleMember } from "./collaboration-policy.js";

export function newBudgetAccount(room, message, defaults) {
  const config = room.collaboration.budget;
  const maxExecutions = config.maxExecutions ?? defaults.maxExecutions;
  const maxPerMember = config.maxPerMember ?? defaults.maxPerMember;
  const integrationReserve = Math.min(config.integrationReserve ?? 1, Math.max(0, maxExecutions - 1));
  const reviewReserve = Math.min(config.reviewReserve ?? 1, Math.max(0, maxExecutions - integrationReserve - 1));
  const account = { id: randomUUID(), originMessageId: message.id, createdAt: Date.now(), maxExecutions, maxPerMember, integrationReserve, reviewReserve, reservations: [], visibleReplies: 0, usage: { tokens: null, modelInternalRetries: null, observation: "host usage unavailable; executions count plugin dispatch attempts" } };
  room.collaboration.budgetAccounts.push(account);
  room.collaboration.activeBudgetId = account.id;
  return account;
}
export const budgetSpent = account => account.reservations.filter(item => item.state !== "released");

export function reserveExecution(room, account, request, defaults = {}) {
  const spent = budgetSpent(account);
  if (spent.length >= account.maxExecutions) return { denied: "execution_limit" };
  const role = request.purpose === "review" ? "review" : request.purpose === "integration" || request.purpose === "unreviewed" ? "integration" : "work";
  const work = integrationWork(room);
  const integrator = work?.ownerSessionId ?? responsibleMember(room)?.sessionId;
  const reviewer = work?.reviewerSessionId;
  const reservedFor = (phase, count) => Math.max(0, count - spent.filter(item => item.phase === phase).length);
  const integrationLeft = reservedFor("integration", account.integrationReserve);
  const reviewLeft = reservedFor("review", account.reviewReserve);
  const protectedGlobal = (role !== "integration" ? integrationLeft : 0) + (role !== "review" ? reviewLeft : 0);
  if (account.maxExecutions - spent.length <= protectedGlobal) return { denied: "reserved_for_closure" };
  const personal = spent.filter(item => item.recipient === request.recipient);
  const protectedMember = (role !== "integration" && request.recipient === integrator ? Math.min(integrationLeft, Math.max(0, account.maxPerMember - 1)) : 0)
    + (role !== "review" && request.recipient === reviewer ? Math.min(reviewLeft, Math.max(0, account.maxPerMember - 1)) : 0);
  if (account.maxPerMember - personal.length <= protectedMember) return { denied: "member_limit" };
  const reservation = { id: randomUUID(), requestId: request.id, recipient: request.recipient, phase: role, state: "reserved", createdAt: Date.now(), ...defaults };
  account.reservations.push(reservation);
  return { reservation };
}

export function recoverBudgets(room) {
  let changed = false;
  for (const account of room.collaboration?.budgetAccounts ?? []) for (const reservation of account.reservations) if (["reserved", "dispatched"].includes(reservation.state)) {
    reservation.state = "unknown"; reservation.reason = "restart"; changed = true;
  }
  return changed;
}
