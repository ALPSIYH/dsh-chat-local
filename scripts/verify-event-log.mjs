#!/usr/bin/env node
/**
 * Read-only offline verification of one room's event log.
 *
 * The event log is an append-only JSONL file per room with a SHA-256 chain and a
 * head anchor beside it. The writer also verifies a cold or changed log. This
 * offline entry point recomputes the chain and anchor and refuses unfinished
 * state/log recovery instead of quietly treating an incomplete history as done.
 *
 * Usage:
 *   node scripts/verify-event-log.mjs <roomId> [--state <rooms.json>]
 *
 * Prints one JSON report on stdout; exits 0 when the log verifies, 1 when it
 * does not, 2 on a usage error. It never writes.
 */
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventLog, eventLogHeadPath, eventLogPath, verifyChain } from "../lib/event-log.js";
import { assertAuditSettled } from "../lib/room-journal.js";

const USAGE = "usage: node scripts/verify-event-log.mjs <roomId> [--state <rooms.json>]";
/** The anchor's null sentinel; see `NO_HEAD` in lib/event-log.js. It is not a hash. */
const NO_HEAD = "null";

function parseArgs(argv) {
  const positional = [];
  let statePath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state") {
      statePath = argv[index + 1];
      if (!statePath) throw new Error(`--state needs a path\n${USAGE}`);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) throw new Error(USAGE);
  return { roomId: positional[0],
    statePath: statePath ?? join(homedir(), ".dsh", "dsh-chat-local", "rooms.json") };
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const { help, roomId, statePath } = parseArgs(process.argv.slice(2));
  if (help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const logPath = eventLogPath(statePath, roomId);
  try { await assertAuditSettled(statePath, roomId); }
  catch (error) { emit({ roomId, log: logPath, ok: false, error: String(error.message) }); return 1; }
  try {
    await access(logPath);
  } catch {
    emit({ roomId, log: logPath, ok: false, error: "no event log for this room" });
    return 1;
  }
  const log = new EventLog(statePath);
  let events;
  try {
    // `read` parses the file and enforces the head anchor, so a missing tail is
    // reported here rather than being walked as if the file were complete.
    events = await log.read(roomId);
  } catch (error) {
    emit({ roomId, log: logPath, ok: false, error: String(error?.message ?? error) });
    return 1;
  }
  const chain = verifyChain(events);
  const recorded = await readFile(eventLogHeadPath(statePath, roomId), "utf8")
    .then((text) => text.trim() || null).catch(() => null);
  const lastEvent = events.at(-1)?.hash ?? null;
  const anchored = recorded === null ? null
    : recorded === NO_HEAD ? lastEvent === null : recorded === lastEvent;
  const ok = chain.ok && anchored !== false;
  emit({ roomId, log: logPath, lines: events.length,
    chain, headAnchor: { recorded, lastEvent, matches: anchored }, ok });
  return ok ? 0 : 1;
}

main().then((status) => { process.exitCode = status; })
  .catch((error) => {
    emit({ ok: false, error: String(error?.message ?? error) });
    process.exitCode = 2;
  });
