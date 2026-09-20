// The native DSH seam: read a member's real session configuration and commit a
// model selection through the host's own primitives. Depends on
// ctx.sessionQuery.observeSession, ctx.sessionController (create / resolveAgent /
// agents.selectForNextRequest) and ctx.llm.resolveCallConfig — recheck these
// when upgrading DSH. No Session history, file grants, native presets or
// deployment-wide model defaults are cloned here.
const capability = (ctx, name) => ctx?.get?.(name) ?? ctx?.[name];

export async function snapshotMemberConfiguration(ctx, member) {
  if (member.nativeSetup) return structuredClone(member.nativeSetup.config);
  const query = capability(ctx,"sessionQuery");
  if (!query?.observeSession) throw new Error("DSH 会话配置读取服务不可用；未创建对话，请重试。");
  const cut = await query.observeSession(member.sourceSessionId ?? member.sessionId, {projectionMode:"all"});
  try {
    const model = cut.projections?.values?.modelSelection?.next ?? capability(ctx,"agentDefaultModel")?.currentSelection?.();
    if (!cut.header?.cwd || !model?.provider || !model?.model) throw new Error(`无法读取 ${member.alias} 的工作目录或模型；请在原生会话检查配置。`);
    const agentPreset=cut.projections?.values?.agentPreset;
    return {cwd:cut.header.cwd, model:structuredClone(model),...(typeof agentPreset==="string"?{agentPreset}:{})};
  } finally { cut[Symbol.dispose]?.(); }
}

export async function selectConversationModel(ctx, member, selection, validate=()=>{}) {
  const controller=capability(ctx,"sessionController");
  const llm=capability(ctx,"llm");
  // Public selectModel also calls agentDefaultModel.saveSelection. Use the
  // verified Host commit primitive instead, behind this version-specific seam.
  if (!controller?.create || !controller?.resolveAgent || !controller?.agents?.selectForNextRequest || !llm?.resolveCallConfig) {
    throw new Error("当前 DSH 不支持独立对话模型配置；未发送任务，请检查插件与 DSH 版本。");
  }
  const resolved=await llm.resolveCallConfig(selection);
  validate();
  if(resolved.provider!==selection.provider || resolved.model!==selection.model) throw new Error(`模型 ${selection.provider}/${selection.model} 不再可用；未静默替换。`);
  const result=await controller.resolveAgent(member.sessionId);
  validate();
  if(result?.error || !result?.agent?.session) throw new Error(result?.error?.message ?? "无法准备原生会话");
  const agent=result.agent;
  if(agent.status!=="idle") throw new Error("该成员的独立会话正在运行；请停止后重试准备。");
  const selected={provider:resolved.provider,model:resolved.model,...(resolved.reasoningEffort===undefined?{}:{reasoningEffort:resolved.reasoningEffort})};
  validate();
  controller.agents.selectForNextRequest(agent,selected);
  // Native configuration must be durable before the group marks setup ready.
  if (typeof agent.session.flush === "function") await agent.session.flush();
  validate();
  return selected;
}

export async function provisionConversationSession(ctx, member, validate=()=>{}) {
  const controller=capability(ctx,"sessionController"),llm=capability(ctx,"llm");
  if(!controller?.create||!controller?.agents?.selectForNextRequest||!llm?.resolveCallConfig)throw new Error("当前 DSH 不支持独立对话模型配置；未发送任务。");
  const config=member.nativeSetup.config;
  validate();
  const resolved=await llm.resolveCallConfig(config.model);
  validate();
  if(resolved.provider!==config.model.provider||resolved.model!==config.model.model)throw new Error("所选模型不再可用，未创建替代会话。");
  const created=await controller.create({sessionId:member.sessionId,cwd:config.cwd,...(config.agentPreset?{agentPreset:config.agentPreset}:{})});
  validate();
  if(String(created.sessionId)!==member.sessionId)throw new Error("DSH 返回了不匹配的会话 ID；未发送任务。");
  if(config.agentPreset&&created.agentPreset!==config.agentPreset)throw new Error("DSH 未采用指定的 Agent 配置；未发送任务。");
  await selectConversationModel(ctx,member,config.model,validate);
  validate();
  await controller.rename({sessionId:member.sessionId,title:member.sessionTitle??member.alias});
  validate();
}
