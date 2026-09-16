import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import vm from "node:vm";
import { DshChatLocalService } from "../lib/room-store.js";
import { apply } from "../lib/index.js";
import { docxFixture } from "./docx-fixture.js";
import { textProtocol } from "../lib/text-protocol.js";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-artifact-resolution-"));
  const roots = { a: join(directory, "workspace-a"), b: join(directory, "workspace-b") };
  const outside = join(directory, "Mobile Documents", "drafts");
  await Promise.all([...Object.values(roots), outside].map(path => mkdir(path, { recursive: true })));
  const ctx = { sessions: { get: id => roots[id] ? { header: { cwd: roots[id] } } : undefined } };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json") });
  try {
    const room = await service.createRoom({ name: "文件解析", autoDeliver: false,
      members: Object.keys(roots).map(sessionId => ({ kind: "session", sessionId, alias: sessionId })) });
    const share = (path, authorKind = "human") => service.send({ roomId: room.id, authorKind,
      author: authorKind === "human" ? "human:me" : "a", text: `[文件](<${path}>)` });
    await run({ directory, roots, outside, ctx, service, room, share });
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
}

test("visible DOCX filename links resolve to exact human-shared paths with spaces, preserving hash and provenance", () => fixture(async ({ service, room, outside, share }) => {
  for (const name of ["manuscript_revision_v03.docx", "supplement_revision_20260905.docx"]) {
    const path = join(outside, name), original = docxFixture();
    await writeFile(path, original);
    const source = await share(path);
    const [reference] = textProtocol.fileReferences(`请核查 \`${name}\``);
    const full = await service.previewArtifact(room.id, { path, sessionId: "a" });
    const short = await service.previewArtifact(room.id, { path: reference, sessionId: "a" });
    assert.equal(short.artifact.id, full.artifact.id, "filename is an alias, not a second artifact");
    assert.equal(short.artifact.version.contentHash, full.artifact.version.contentHash);
    assert.equal(short.artifact.replica.relativePath, path);
    assert.deepEqual(short.access, { mode: "read_only", scope: "human_shared_file", sourceMessageId: source.id });
    assert.match(short.content, /样本数/);
    assert.deepEqual(await readFile(path), original);
    assert.equal((await service.previewArtifact(room.id, { path: reference })).content, full.content);
  }
}));

test("same-name shared files require a choice; repeated shares are deduplicated and exact paths still work", () => fixture(async ({ service, room, roots, outside, share }) => {
  const first = join(outside, "paper.md"), second = join(roots.b, "paper.md");
  await writeFile(first, "first"); await writeFile(second, "second");
  await share(first); await share(first); await share(second);
  await assert.rejects(service.previewArtifact(room.id, { path: "paper.md", sessionId: "a" }), error => {
    assert.equal(error.code, "FILE_REFERENCE_AMBIGUOUS"); assert.equal(error.status, 409);
    assert.deepEqual(error.candidates.map(item => item.path).sort(), [first, second].sort());
    for (const path of [first, second]) assert.ok(error.message.includes(path), "Agent error includes selectable full paths");
    return true;
  });
  for (const path of [first, second]) assert.equal((await service.previewArtifact(room.id, { path, sessionId: "a" })).content, await readFile(path, "utf8"));
}));

test("workspace and shared names cannot silently shadow one another; overlapping roots deduplicate the same real file", () => fixture(async ({ service, room, roots, outside, share }) => {
  const workspace = join(roots.a, "paper.md"), external = join(outside, "paper.md");
  await writeFile(workspace, "local"); await writeFile(external, "shared"); await share(external);
  await assert.rejects(service.previewArtifact(room.id, { path: "paper.md", sessionId: "a" }), { code: "FILE_REFERENCE_AMBIGUOUS" });
  await share(workspace);
  await assert.rejects(service.previewArtifact(room.id, { path: "paper.md", sessionId: "a" }), error => error.candidates.length === 2);
  roots.b = roots.a;
  await writeFile(join(roots.a, "unique.md"), "one");
  assert.equal((await service.previewArtifact(room.id, { path: "unique.md" })).content, "one");
}));

test("ambiguous workspace-only references expose the owning session without expanding an Agent's scope", () => fixture(async ({ service, room, roots }) => {
  for (const [id, path] of Object.entries(roots)) await writeFile(join(path, "paper.md"), id);
  await assert.rejects(service.previewArtifact(room.id, { path: "paper.md" }), error => {
    assert.deepEqual(error.candidates.map(item => item.sessionId).sort(), ["a", "b"]); return true;
  });
  assert.equal((await service.previewArtifact(room.id, { path: "paper.md", sessionId: "a" })).content, "a");
  await assert.rejects(service.previewArtifact(room.id, { path: join(roots.b, "paper.md"), sessionId: "a" }), { code: "FILE_NOT_AUTHORIZED" });
}));

test("a missing shared file is not a permission request or permission to substitute another version", () => fixture(async ({ service, room, outside, roots, share }) => {
  const missing = join(outside, "paper.md"); await share(missing);
  for (const path of [missing, "paper.md"]) await assert.rejects(service.previewArtifact(room.id, { path, sessionId: "a" }), { code: "FILE_NOT_FOUND", status: 404 });
  const sameName = join(roots.b, "paper.md"); await writeFile(sameName, "different"); await share(sameName);
  await assert.rejects(service.previewArtifact(room.id, { path: "paper.md", sessionId: "a" }), error => {
    assert.equal(error.code, "FILE_REFERENCE_AMBIGUOUS");
    assert.equal(error.candidates.find(item => item.path === missing).available, false);
    return true;
  });
}));

test("filename resolution preserves exact-file sharing, room isolation and symlink boundaries", () => fixture(async ({ service, room, roots, outside, share }) => {
  const shared = join(outside, "paper_v03.md"), neighbor = join(outside, "paper_v04.md");
  await writeFile(shared, "shared"); await writeFile(neighbor, "not shared"); await share(shared); await share(neighbor, "session");
  await assert.rejects(service.previewArtifact(room.id, { path: neighbor }), { code: "FILE_NOT_AUTHORIZED" });
  for (const path of [basename(neighbor), "paper.md", "other/paper_v03.md", "../paper_v03.md"]) {
    await assert.rejects(service.previewArtifact(room.id, { path, sessionId: "a" }));
  }
  await symlink(neighbor, join(roots.a, "escape.md"));
  await assert.rejects(service.previewArtifact(room.id, { path: "escape.md", sessionId: "a" }), { code: "FILE_NOT_AUTHORIZED" });
  const other = await service.createRoom({ name: "另一房间", autoDeliver: false, members: [{ kind: "session", sessionId: "a", alias: "a" }] });
  await assert.rejects(service.previewArtifact(other.id, { path: "paper_v03.md", sessionId: "a" }), { code: "FILE_REFERENCE_UNRESOLVED" });
  const statePath = join(roots.a, "../rooms.json"), before = await readFile(statePath, "utf8");
  await service.previewArtifact(room.id, { path: "paper_v03.md", sessionId: "a" }, { checkOnly: true });
  assert.equal(await readFile(statePath, "utf8"), before, "recovery checks do not register artifacts");
}));

test("missing absolute files in a later participant workspace are reported as missing, not unshared", () => fixture(async ({ service, room, roots }) => {
  await assert.rejects(service.previewArtifact(room.id, { path: join(roots.b, "missing.md") }), { code: "FILE_NOT_FOUND" });
}));

test("actual HTTP handler carries actionable file error codes and candidates", () => fixture(async ({ directory, ctx, room, outside, roots, share }) => {
  const first = join(outside, "paper.md"), second = join(roots.b, "paper.md");
  await writeFile(first, "first"); await writeFile(second, "second"); await share(first); await share(second);
  let handler; const disposers = [];
  apply({ ...ctx, effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); }, on() {},
    tools: { register() {}, guard() {} }, webServer: { register(route) { handler = route.handler; } } }, { path: join(directory, "rooms.json") });
  const request = async path => {
    const req = Readable.from([Buffer.from(JSON.stringify({ path, sessionId: "a" }))]); req.method = "POST";
    req.url = `/api/dsh-chat-local/rooms/${room.id}/artifacts/preview`;
    let status, body; await handler(req, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
    return { status, body };
  };
  try {
    const ambiguous = await request("paper.md");
    assert.equal(ambiguous.status, 409); assert.equal(ambiguous.body.code, "FILE_REFERENCE_AMBIGUOUS");
    assert.equal(ambiguous.body.candidates.length, 2);
    assert.equal((await request("unmentioned.md")).body.code, "FILE_REFERENCE_UNRESOLVED");
  } finally { for (const dispose of disposers.reverse()) await dispose(); }
}));

test("browser API preserves resolution details and the chooser opens only the selected exact path", async () => {
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const candidates = [{ path: "/shared/one/paper.md", sessionId: "a", scope: "human_shared_file", available: true },
    { path: "/shared/two/paper.md", sessionId: "b", scope: "human_shared_file", available: true }];
  const api = source.slice(source.indexOf("    async function api("), source.indexOf("    function statusLabel("));
  await assert.rejects(vm.runInNewContext(`${api}\napi('/preview')`, { BASE: "", fetch: async () => ({ ok: false, status: 409,
    json: async () => ({ ok: false, error: "multiple files", code: "FILE_REFERENCE_AMBIGUOUS", candidates }) }) }), error => error.code === "FILE_REFERENCE_AMBIGUOUS" && error.candidates.length === 2);
  const helper = source.slice(source.indexOf("    function ArtifactResolutionChoices("), source.indexOf("    function artifactReferences("));
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
  const chosen = [], rendered = vm.runInNewContext(`${helper}\nArtifactResolutionChoices({preview:{logicalName:'paper.md',candidates},onChoose})`,
    { h, candidates, onChoose: (...args) => chosen.push(args) });
  const nodes = node => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)];
  const buttons = nodes(rendered).filter(node => node.type === "button");
  assert.equal(buttons.length, 2); assert.ok(JSON.stringify(rendered).includes(candidates[1].path));
  assert.equal(chosen.length, 0, "rendering does not auto-select or read any candidate");
  buttons[1].props.onClick();
  assert.equal(chosen[0][0], candidates[1].path); assert.equal(chosen[0][1].author, "b");
  const messages = source.slice(source.indexOf("    function artifactFailureMessage("), source.indexOf("    function ArtifactResolutionChoices("));
  const message = code => vm.runInNewContext(`${messages}\nartifactFailureMessage({code,message:'error'})`, { code });
  assert.match(message("FILE_NOT_FOUND"), /移动|删除/);
  assert.doesNotMatch(message("FILE_NOT_FOUND"), /重新共享|开放权限/);
  assert.match(message("FILE_REFERENCE_UNRESOLVED"), /完整路径/);
  assert.match(message("FILE_NOT_AUTHORIZED"), /只读/);
});
