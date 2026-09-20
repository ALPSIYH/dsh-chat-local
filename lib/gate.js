/**
 * The governance gate: one pure judgement about a member's tool execution.
 *
 * The gate answers a narrow question — should the room let this member perform
 * this action right now? — and answers it as one of four judgements:
 *
 *     "allow" | "require_confirmation" | "require_independent_review" | "deny"
 *
 * The tool guard that consults it can only allow (`undefined`) or refuse (a
 * string), so every judgement but `allow` is a refusal there, each with its own
 * explanation. The gate itself performs no I/O, reads no clock, and holds no
 * state: the same input always produces the same judgement, so a decision can be
 * replayed and audited from the numbers it was taken on.
 *
 * Two decisions the plan leaves open, settled here:
 *
 * - **What the pair is.** A tool execution names no counterparty. The pair is
 *   therefore the acting member **as the target** — their own encountered
 *   record: the deliveries addressed to them and how those settled, and the
 *   disagreements recorded against them. The rules then read as statements about
 *   the member the room is dealing with ("the room cannot reliably reach them",
 *   "they carry an open disagreement"), never as one member's private opinion of
 *   another.
 * - **Where `riskClass` and `action` come from.** From `GATE_TOOL_CLASSES`, one
 *   explicit table below, keyed by tool name. There is no substring test and no
 *   per-tool `if` anywhere else: a room's behaviour under the gate is readable
 *   from this one table, and adding a tool means adding a row.
 *
 * The table's fallback is deliberately the safe direction: a tool it does not
 * name is treated as high impact (`GATE_UNCLASSIFIED_TOOL`), exactly as the
 * restricted-turn read allowance treats an unlisted tool as not read-only. A new
 * tool must be classified here deliberately. An execution with no usable name
 * cannot be classified at all, and the judgement then fails closed (`deny`)
 * rather than pretending an unknown action is harmless.
 *
 * The counter side is the opposite on purpose. The rules fire on what the room
 * **recorded**; a counter snapshot that is absent, unreadable, or missing a
 * field establishes nothing about a member, and a governance gate that refused a
 * member on no evidence would be inventing a fact about them. So an absent
 * snapshot allows, while an unclassifiable *action* is denied.
 */

/** The risk classes the table may use. `high` is what the rules act on. */
export const GATE_RISK_CLASSES = Object.freeze(["high", "low"]);

/**
 * What an execution does, as far as the gate is concerned:
 *
 * - `execute` changes the host, the filesystem, other sessions, or a service;
 * - `review` signs off or rules on work someone else did;
 * - `read` reads something;
 * - `work` is bookkeeping inside this session or this room.
 */
export const GATE_ACTIONS = Object.freeze(["execute", "review", "read", "work"]);

/** Tools whose effect is on the host, the filesystem, other sessions, or a service. */
const HIGH_IMPACT_TOOLS = [
  // Shell and code execution.
  "bash", "run_code", "execute",
  // Files: writing, moving, deleting, publishing.
  "write", "write_file", "edit", "apply_patch", "delete", "move", "present",
  // Agents and processes.
  "subagent", "subagent_fork", "workflow", "ralph", "interrupt_agent", "send_message",
  "session_send", "job_kill", "restart_harness",
  // Extending the running host in-process.
  "cordis_define", "cordis_run", "cordis_stop", "cordis_undefine",
  // Generating a deliverable with an external service.
  "codex_connect_image_generate"
];

/** Tools that read, search, or discover, and change nothing. */
const READ_TOOLS = [
  "read", "read_file", "read_image", "read_artifact", "view", "view_image",
  "get", "list", "search", "find", "inspect", "status", "stat", "query", "glob", "grep",
  "fetch", "web_search", "web_fetch",
  "list_agents", "list_subagent_models", "get_goal", "session_list", "session_messages",
  "job_list", "job_output", "skill",
  "cordis_inspect_list", "cordis_inspect_query", "cordis_inspect_self",
  // Browser reads: the page is not touched.
  "browser_a11y", "browser_challenge", "browser_content", "browser_history",
  "browser_list_tabs", "browser_scrape", "browser_screenshot", "browser_session",
  "browser_snapshot", "browser_wait"
];

/**
 * Tools this plugin registers: they act inside the room, and it enforces its own
 * rules.
 *
 * `chat_appraise` is registered here deliberately rather than left to the
 * fallback. It writes one `appraisal` event into this room's own log, changes no
 * user file, permission or other session, and rules on nothing anyone else did:
 * recording what you think of a counterparty is room bookkeeping, the same class
 * as `chat_work`. Leaving it out would classify it as high impact and as a
 * possible review, so a member carrying an open disagreement would be refused
 * their own appraisal — and an unregistered tool is exactly the state the
 * fallback's comment warns against.
 */
const ROOM_READ_TOOLS = ["chat_memory", "chat_relationships", "chat_identity", "chat_recall", "chat_rooms", "chat_read_document"];
const ROOM_WORK_TOOLS = [
  "chat_create", "chat_join", "chat_invite", "chat_send", "chat_work", "chat_manage",
  "chat_charter_propose", "chat_appraise"
];

/** Tools that record a verdict or a sign-off. */
const REVIEW_TOOLS = ["chat_charter_review"];

/**
 * Tool name -> `{ riskClass, action }`. The one place a tool's impact and kind
 * are decided, so the gate can be read and unit-tested without following a call
 * chain. Grouped by what each group means rather than by the order it was
 * written in; a name may appear in exactly one group.
 */
export const GATE_TOOL_CLASSES = new Map([
  ...HIGH_IMPACT_TOOLS.map((name) => [name, Object.freeze({ riskClass: "high", action: "execute" })]),
  ...READ_TOOLS.map((name) => [name, Object.freeze({ riskClass: "low", action: "read" })]),
  ...ROOM_READ_TOOLS.map((name) => [name, Object.freeze({ riskClass: "low", action: "read" })]),
  ...ROOM_WORK_TOOLS.map((name) => [name, Object.freeze({ riskClass: "low", action: "work" })]),
  ...REVIEW_TOOLS.map((name) => [name, Object.freeze({ riskClass: "low", action: "review" })])
]);

/**
 * What the table says about a tool it does not name.
 *
 * The conservative reading of an effect nobody stated, in the same direction as
 * the restricted-turn read allowance that refuses an unlisted tool rather than
 * treating it as read-only:
 *
 * - `riskClass` is `high`, so the confirmation rule can reach it;
 * - `unclassified` is set, so the judgement also treats it as a possible review
 *   action. "This is a review that must not be self-reviewed" is one of the
 *   effects an unlisted tool could have, and leaving a tool out of the table
 *   must not be a way to become the reviewer of one's own work.
 *
 * `action` stays `execute`, which is the truthful statement about what is known:
 * the tool's kind is unstated, not that it reviews. The judgement is what acts
 * on the missing classification.
 */
export const GATE_UNCLASSIFIED_TOOL = Object.freeze({ riskClass: "high", action: "execute", unclassified: true });

/** An execution whose name is missing or blank: nothing the gate can classify. */
const GATE_UNNAMEABLE_TOOL = Object.freeze({ riskClass: undefined, action: undefined });

/**
 * The tools whose gate action is carried by an argument rather than by the tool
 * name, and the argument values that make that action a review. This is data too:
 * the rule stays in one table instead of becoming a special case in the guard.
 */
const ACTION_ARGUMENTS = new Map([["chat_work", "action"]]);
const REVIEW_ARGUMENT_VALUES = new Set(["review"]);

/**
 * Read one execution as `{ riskClass, action }`, and as `unclassified: true` when
 * the table does not name the tool at all. A blank or missing tool name returns
 * no classification, which the judgement below turns into `deny`.
 */
export function classifyToolExecution(name, args) {
  if (typeof name !== "string" || name === "") return { ...GATE_UNNAMEABLE_TOOL };
  const entry = GATE_TOOL_CLASSES.get(name) ?? GATE_UNCLASSIFIED_TOOL;
  const carrier = ACTION_ARGUMENTS.get(name);
  if (carrier !== undefined && REVIEW_ARGUMENT_VALUES.has(args?.[carrier])) {
    return { riskClass: entry.riskClass, action: "review" };
  }
  return entry === GATE_UNCLASSIFIED_TOOL
    ? { riskClass: entry.riskClass, action: entry.action, unclassified: true }
    : { riskClass: entry.riskClass, action: entry.action };
}

/** A finite counter value, or 0 for a field the snapshot does not carry as a count. */
function count(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Read the counter fields the rules use, or `undefined` when there is no counter
 * snapshot to read.
 */
function countersOf(pair) {
  const counters = pair?.counters;
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) return undefined;
  return {
    deliveryFailures: count(counters.deliveryFailures),
    deliverySuccesses: count(counters.deliverySuccesses),
    unresolvedDisagreements: count(counters.unresolvedDisagreements)
  };
}

/**
 * Judge one execution.
 *
 * `policy` is the room's live policy: the gate is off unless it says `gate: true`
 * explicitly, and while it is off this function answers `allow` for every input,
 * so a caller that consults it unconditionally cannot change a room that never
 * enabled the gate.
 *
 * With the gate on, the judgements are decided in this order:
 *
 * 1. a `riskClass` or `action` the gate cannot classify -> `deny`;
 * 2. a review action by a member with an unresolved disagreement against them ->
 *    `require_independent_review`;
 * 3. a high-impact action by a member whose deliveries have failed and never
 *    once succeeded -> `require_confirmation`;
 * 4. otherwise -> `allow`.
 *
 * Rule 2 reads `unclassified: true` from the classification as a review too: a
 * tool the table does not name could be one, and the rule that keeps a member
 * from signing off on their own work must not be avoidable by leaving the tool
 * out of the table.
 *
 * Rule 2 outranks rule 3 when both hold: a member who must not be the one to
 * sign off is not cured by the user confirming the action, so the stronger and
 * more specific remedy is the one that speaks.
 */
export function evaluateGate({ pair, action, riskClass, unclassified = false, policy } = {}) {
  if (policy?.gate !== true) return "allow";
  if (typeof riskClass !== "string" || !GATE_RISK_CLASSES.includes(riskClass)) return "deny";
  if (typeof action !== "string" || !GATE_ACTIONS.includes(action)) return "deny";
  const counters = countersOf(pair);
  if (counters === undefined) return "allow";
  if ((action === "review" || unclassified === true) && counters.unresolvedDisagreements > 0) {
    return "require_independent_review";
  }
  if (riskClass === "high" && counters.deliveryFailures > 0 && counters.deliverySuccesses === 0) {
    return "require_confirmation";
  }
  return "allow";
}
