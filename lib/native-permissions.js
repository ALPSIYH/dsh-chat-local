// Uses DSH's canonical preset setter; no second implementation of sandbox or approval rules.
export async function readNativePermission(ctx, sessionId) {
  const presets=ctx?.get?.("permissionPresets")??ctx?.permissionPresets;
  const agents=ctx?.get?.("agents")??ctx?.agents;
  const live=agents?.get?.(sessionId)?.session;
  if(live&&presets?.current)return presets.current(live);
  const query=ctx?.get?.("sessionQuery")??ctx?.sessionQuery;
  if(!query?.observeSession)return undefined;
  // Read DSH's canonical projection without loading/waking an Agent or
  // recreating the sandbox/approval folding rules in this plugin.
  const observation=await query.observeSession(sessionId,{projectionMode:"all"});
  try { return observation.projections?.values?.permissions?.currentValue; }
  finally { observation[Symbol.dispose]?.(); }
}

export async function prepareNativePreset(ctx, members, preset) {
  const service = ctx?.get?.("permissionPresets") ?? ctx?.permissionPresets;
  const agents = ctx?.get?.("agents") ?? ctx?.agents;
  const controller = ctx?.get?.("sessionController") ?? ctx?.sessionController;
  if (!service?.resolve || !service?.set || !service?.current) throw new Error("DSH 原生权限服务不可用；请先在原生会话中设置权限，或选择跟随 DSH。");
  const spec = service.resolve(preset);
  if (spec.sandbox !== preset || spec.approval !== (preset === "danger-full-access" ? "never" : "ask")) throw new Error("DSH 原生预设的实际沙箱/审批设置与该模式不符，请先核对原生权限配置。");
  const targets = [];
  for (const member of members) {
    let agent = agents?.get?.(member.sessionId);
    if (!agent) {
      const resolved = await controller?.resolveAgent?.(member.sessionId);
      if (resolved?.error) throw new Error(`无法加载 ${member.alias} 的 DSH 权限：${resolved.error.message}`);
      agent = resolved?.agent;
    }
    if (!agent?.session) throw new Error(`无法加载 ${member.alias} 的 DSH 会话，请先打开它。`);
    if (agent.status !== "idle") throw new Error(`${member.alias} 的 DSH 会话正在运行或 busy；请结束当前任务后切换权限。`);
    const before = service.current(agent.session);
    // A custom bundle cannot be losslessly restored through the public preset API.
    if (before === "custom") throw new Error(`${member.alias} 使用自定义原生权限；请在其 DSH 会话中选择预设后再批量切换。`);
    service.resolve(before);
    targets.push({ agent, before, sessionId: member.sessionId });
  }
  return () => {
    if (targets.some(({agent}) => agent.status !== "idle")) throw new Error("参与者会话已开始运行，权限未变更。");
    const changed = [];
    try {
      for (const target of targets) { changed.push(target); service.set(target.agent.session, preset); }
    } catch (error) {
      const rollbackFailures = [];
      for (const target of changed.reverse()) try { service.set(target.agent.session, target.before); } catch { rollbackFailures.push(target.sessionId); }
      throw new Error(`DSH 权限切换失败：${error.message}。${rollbackFailures.length ? `以下会话未能恢复，请到原生 DSH 核对：${rollbackFailures.join("、")}` : "已恢复此前权限。"}`);
    }
    return targets.map(({sessionId}) => ({ sessionId, preset }));
  };
}
