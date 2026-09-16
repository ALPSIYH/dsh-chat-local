// Rooms remain the execution aggregate and retain every existing ID and route.
// Groups contain configuration only: never messages, work records or file grants.
export function groupFromRoom(room) {
  return {
    id: room.groupId ?? room.id, name: room.name, revision: 1, createdAt: room.createdAt,
    defaults: {
      autoDeliver: room.autoDeliver, charter: room.profile?.charter ?? "",
      members: room.members.map(member => ({
        id: member.memberId ?? member.sessionId, alias: member.alias,
        ...(member.role ? {role: member.role} : {}), ...(member.mandate ? {mandate: member.mandate} : {}),
        sourceSessionId: member.sessionId
      }))
    }
  };
}

export function migrateGroups(rooms, input) {
  if (input !== undefined && !Array.isArray(input)) throw new Error("Invalid group state; source data was not overwritten");
  const groups = structuredClone(input ?? []);
  const seen = new Set();
  for (const group of groups) {
    if (!group?.id || !group.name || seen.has(group.id) || !Array.isArray(group.defaults?.members)) throw new Error("Invalid or duplicate group configuration");
    seen.add(group.id);
  }
  for (const room of rooms) {
    if (room.groupId && !seen.has(room.groupId)) throw new Error(`Missing group for conversation ${room.id}`);
    if (!room.groupId) {
      const group = groupFromRoom(room);
      if (!seen.has(group.id)) { groups.push(group); seen.add(group.id); }
      room.groupId = group.id;
    }
  }
  return groups;
}

export function conversationTitle(text) {
  const title = String(text).replace(/\[[^\]]+\]\([^)]*\)/gu, value => value.slice(1,value.indexOf("]")))
    .replace(/[`#*_>]/gu," ").replace(/\s+/gu," ").trim();
  return title.slice(0,38) + (title.length > 38 ? "…" : "") || "新对话";
}
