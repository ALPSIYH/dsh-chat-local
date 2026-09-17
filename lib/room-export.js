import { createHash } from "node:crypto";

export function exportRoomSnapshot(room, version, format = "json") {
  if(!["json","markdown"].includes(format)) throw new TypeError("export format must be json or markdown");
  const snapshot=structuredClone(room);
  const exportedAt=new Date().toISOString();
  const contentHash=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const filename=room.name.replace(/[<>:"/\\|?*\x00-\x1f]/gu,"_").slice(0,80)||"群聊";
  if(format==="json")return {filename:`${filename}_${exportedAt.slice(0,10)}.json`,mimeType:"application/json",content:JSON.stringify({format:"dsh-chat-local-export",stateVersion:version,exportedAt,contentHash,room:snapshot},null,2)};
  const lines=[`# ${room.name}`,"",`导出时间：${exportedAt}（UTC）`, `房间 ID：${room.id}`,`房间快照 SHA-256：${contentHash}`,"","> 包含完整对话与当前台账；完整版本和审计历史请另存 JSON 备份。不会额外读取成员私聊或引用文件。消息按房间序号排列；导出不代表任务验收。", "", `当前权限：${room.policy?.defaultActionMode ?? "未记录"} · 策略版本 ${room.policy?.revision ?? "未记录"}`, "", "## 房间目标与章程", "",room.profile?.purpose??"", "", room.profile?.charter??"", "", "## 参与者",""];
  const person=id=>room.members.find(member=>member.sessionId===id)?.alias || id || "未指定";
  if(room.origin) lines.push("", "## 分支背景（引用，不是当前授权）", "", `来源对话：${room.origin.roomName} · ${room.origin.roomId}`,room.origin.background??"",...room.origin.messages.flatMap(message=>[`来源消息：${message.id} · ${message.author}`,"",message.text,""]),"## 当前对话参与者","");
  const statuses={open:"待处理",in_progress:"进行中",blocked:"受阻",in_review:"待验收",proposed:"待决定",done:"已完成",decided:"已决定",resolved:"已解决",archived:"已归档"};
  for(const member of room.members)lines.push(`- ${member.alias} · ${member.role||"未设置职务"} · Session ${member.sessionId}${member.mandate?`\n  职责：${member.mandate}`:""}`);
  lines.push("", "## 协作台账", "");
  for(const entry of room.ledger)lines.push(`### ${entry.title}`,"",`类型：${entry.kind} · 状态：${statuses[entry.status]??entry.status} · 版本：${entry.revision} · ID：${entry.id}`,`负责人：${person(entry.ownerSessionId)} · 验收人：${person(entry.reviewerSessionId)}`,"",entry.details||"",entry.question?`待决问题：${entry.question}`:"",...(entry.decisionOptions??[]).map(option=>`- ${option.label}：${option.description}`),entry.acceptanceCriteria?`验收标准：${entry.acceptanceCriteria}`:"",entry.progress?.summary?`进展：${entry.progress.summary}`:"",entry.submission?.deliverable?`交付：${entry.submission.deliverable}`:"",entry.review?.summary?`处理意见：${entry.review.summary}`:"",entry.review?.selectedOption?`已选方案：${entry.review.selectedOption.label}`:"","");
  lines.push("## 群聊完整记录","");
  for(const message of room.messages)lines.push(`### ${message.roomSeq} · ${message.authorAlias||message.author} · ${new Date(message.sentAt).toISOString()}`,"",`消息 ID：${message.id}${message.causedByMessageId?` · 回应：${message.causedByMessageId}`:""}${message.correctsMessageId?` · 纠正：${message.correctsMessageId}`:""}`,"",message.text,"",...(message.deliveries?.length?[`投递：${message.deliveries.map(d=>`${d.member} / ${d.status}${d.error?` / ${d.error}`:""}`).join("；")}`,""]:[]));
  return {filename:`${filename}_${exportedAt.slice(0,10)}.md`,mimeType:"text/markdown",content:lines.join("\n")};
}

/**
 * A run snapshot is the whole experimental unit: the read model, the immutable
 * event log, and the configuration hash that produced them. Restoring one is
 * how a counterfactual run is set up, so the hash must cover both halves.
 */
export function exportRunSnapshot({ room, version, events, configHash, exportedAt = new Date().toISOString() }) {
  const body = { format: "dsh-chat-local-run-snapshot", stateVersion: version, exportedAt, configHash, room, events };
  const contentHash = createHash("sha256").update(JSON.stringify({ room, events, configHash })).digest("hex");
  return {
    filename: `${(room.name || "room").replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").slice(0, 80)}_${exportedAt.slice(0, 10)}.snapshot.json`,
    mimeType: "application/json",
    content: JSON.stringify({ ...body, contentHash }, null, 2)
  };
}

/** Verify a snapshot before it is allowed to overwrite anything. */
export function validateSnapshot(parsed) {
  if (!parsed || parsed.format !== "dsh-chat-local-run-snapshot") return { ok: false, reason: "not a run snapshot" };
  if (!parsed.room || !Array.isArray(parsed.room.messages)) return { ok: false, reason: "snapshot has no room" };
  if (!Array.isArray(parsed.events)) return { ok: false, reason: "snapshot has no event log" };
  const expected = createHash("sha256")
    .update(JSON.stringify({ room: parsed.room, events: parsed.events, configHash: parsed.configHash }))
    .digest("hex");
  if (expected !== parsed.contentHash) return { ok: false, reason: "content hash mismatch; the snapshot was modified" };
  return { ok: true, snapshot: parsed };
}
