import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DshChatLocalService } from "../lib/room-store.js";

/**
 * The declaration file is the package's public surface for every consumer that
 * reads types instead of source, and the service's prototype is the surface the
 * runtime actually hands out. The two are written by hand, one commit apart, and
 * a manual re-check did not survive the next commit: `settledAudit` went
 * undeclared and a `quiesce` that exists nowhere was declared in its place. A
 * convention that depends on someone re-reading a file is not a convention, so
 * the comparison is mechanical.
 *
 * The declared names are read by scanning the class body at brace depth, not by
 * matching method-shaped text: a source scan is fooled by control-flow lines
 * (`for (`, `if (`) and misses any declaration not written as `^  name(`. A name
 * is taken only where a class member can start — leading modifiers included —
 * and the nested `workspace` literal is left to the brace counter. Reflection is
 * the other side: the names on the prototype of a real instance, so a method the
 * class does not actually expose cannot be excused as "internal".
 */
const here = dirname(fileURLToPath(import.meta.url));
const DECLARATION = join(here, "..", "lib", "room-store.d.ts");
// The one member that is not a method, and the constructor itself, which the
// class holds as a non-enumerable property rather than a described method.
const NOT_DESCRIBED_AS_METHODS = new Set(["constructor", "workspace"]);
// Leading modifiers a class member can carry. Matching only lines that begin
// directly with the name let every modifier-prefixed member through — `private
// ghostMethod(): void;` and `readonly ghostProp: any;` both passed — which is
// exactly the drift this test exists to make unmergeable. A modifier is only
// consumed when whitespace follows it, so a member genuinely named `readonly`
// or `get` (`readonly: boolean;`) is still read as that name.
const LEADING_MODIFIERS = /^(?:(?:public|private|protected|readonly|static|abstract|declare|override|async|get|set)\s+)+/u;

/** The method and property names declared on the class in a `.d.ts` source. */
function declaredNames(source) {
  // Other exported interfaces are not members of the service class.
  source = source.slice(source.indexOf("export declare class DshChatLocalService"));
  const names = new Set();
  let depth = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const body = line.replace(LEADING_MODIFIERS, "");
    const member = depth === 1 && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")
      ? /^([A-Za-z_$][A-Za-z0-9_$]*)\s*[:(<]/.exec(body)
      : null;
    if (member) names.add(member[1]);
    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
  }
  return names;
}

test("the declaration file names every public method and invents none", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-declaration-"));
  const service = new DshChatLocalService({ get() { return undefined; } }, { path: join(directory, "rooms.json") });
  try {
    await service.ready;
    const reflected = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(service))
      .filter((name) => !NOT_DESCRIBED_AS_METHODS.has(name)));
    const declared = new Set([...declaredNames(await readFile(DECLARATION, "utf8"))]
      .filter((name) => !NOT_DESCRIBED_AS_METHODS.has(name)));
    const omitted = [...reflected].filter((name) => !declared.has(name)).sort();
    const phantom = [...declared].filter((name) => !reflected.has(name)).sort();
    // One assertion, so a failure reports both halves at once: a name that went
    // undeclared and a name that was declared without a method behind it.
    assert.deepEqual({ omitted, phantom }, { omitted: [], phantom: [] },
      `lib/room-store.d.ts must describe exactly the service's public methods (omitted ${JSON.stringify(omitted)}, phantom ${JSON.stringify(phantom)})`);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
