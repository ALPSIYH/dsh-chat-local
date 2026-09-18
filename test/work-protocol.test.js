import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { CLOSED_LEDGER_STATUSES, workProtocol } from "../lib/work-protocol.js";

/**
 * R43: the ledger's closed-status vocabulary is one contract, not a copy per
 * module. `lib/room-store.js` owned the definition and `lib/relationship.js`
 * carried a duplicate behind a "the two lists must move together" comment —
 * exactly the kind of comment that rots. This suite pins the single definition
 * so the copy cannot come back.
 */

/** The ledger's full status vocabulary, from `LEDGER_STATUSES` in the store. */
const LEDGER_STATUSES = ["open", "in_progress", "blocked", "in_review", "proposed",
  "done", "decided", "resolved", "archived", "cancelled", "paused"];

test("the closed ledger statuses are exported from the neutral protocol module", () => {
  assert.ok(CLOSED_LEDGER_STATUSES instanceof Set);
  assert.deepEqual([...CLOSED_LEDGER_STATUSES].sort(),
    ["archived", "cancelled", "decided", "done", "paused", "resolved"]);
});

test("the shared list is exactly what the browser-side protocol closes on", () => {
  // `workProtocol.closed` is the same vocabulary read from the browser bundle:
  // if the two ever disagree, a status is closed in the ledger UI and open in
  // the derivation (or the reverse), which is the drift R43 removes.
  for (const status of LEDGER_STATUSES) {
    assert.equal(workProtocol.closed(status), CLOSED_LEDGER_STATUSES.has(status), status);
  }
});

test("exactly one file in lib/ defines the closed ledger statuses", async () => {
  const defining = [];
  for (const entry of await readdir(new URL("../lib/", import.meta.url), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const source = await readFile(new URL(`../lib/${entry.name}`, import.meta.url), "utf8");
    if (/CLOSED_LEDGER_STATUSES\s*=/.test(source)) defining.push(entry.name);
  }
  assert.deepEqual(defining, ["work-protocol.js"],
    "the closed-status vocabulary must have exactly one definition in lib/");
});

test("the store and the derivation both read that one definition", async () => {
  // The behavioural half of the same claim: an import is not a copy, so the
  // modules that consume the vocabulary must not carry the literal list.
  for (const file of ["../lib/room-store.js", "../lib/relationship.js"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /import\s*\{[^}]*CLOSED_LEDGER_STATUSES[^}]*\}\s*from\s*"\.\/work-protocol\.js"/,
      `${file} must import the shared vocabulary`);
    assert.doesNotMatch(source, /new Set\(\["done"/,
      `${file} must not carry a second copy of the list`);
  }
});
