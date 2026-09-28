/** Browser module: render authority supplied by the host, never infer acceptance from idle. */
export function createCollaborationUI(React, h, api) {
  const outcomeLabel = value => ({accepted:"已驗收",partial:"已交部分成果",waiting:"等待條件",budget_exhausted:"執行額度已用盡",incomplete:"工作尚未完成",unknown:"執行結果未知"})[value] ?? "尚無驗收結果";
  const purposeLabel=value=>({request:"請處理",notify:"僅告知",correction:"更正",objection:"異議",discussion:"徵詢",status:"進度查詢",review:"驗收",integration:"整合",unreviewed:"待審閱增量",handoff:"交接",assignment:"接手工作",recovery:"解除阻斷",decision:"決定通知",charter_review:"審閱章程",charter_rework:"修訂章程"})[value]??value;
  const requestLabel=value=>({pending:"待處理",dispatched:"已派送",unknown:"結果未知",needs_resolution:"待記錄處置",resolved:"已處置",obsolete:"已失效"})[value]??value;
  const waitLabel=value=>({work_inactive:"工作已停止，原問題仍待處置",awaiting_integration:"先由整合者處理未閱材料",no_budget:"尚無執行額度，需人類開啟一次工作",execution_limit:"本次執行額度已用盡",reserved_for_closure:"剩餘額度保留給整合與驗收",member_limit:"此成員可用額度已用盡",user_stopped:"人類已停止執行",restart:"程序已重啟，先核對原執行結果",snapshot_restore:"已恢復快照，先核對原執行結果"})[value]??`等待條件：${value}`;
  const workLabel=value=>({open:"待接手",in_progress:"處理中",in_review:"待驗收",blocked:"受阻",done:"已驗收",paused:"已暫停",cancelled:"已取消",archived:"已歸檔"})[value]??value;
  function audienceLabel({strategy="legacy",autoDeliver,purpose="auto",all=false,names=[],count=0,inline=false}) {
    if(!count)return "尚未添加成員 · 訊息僅記錄";
    const modern=strategy!=="legacy";
    if(modern&&purpose==="notify")return "僅告知 · 不要求回覆、不立即喚醒";
    if(all)return `發送給全部 ${count} 位成員`;
    if(names.length)return `發送給 ${names.join("、")}${inline?"（含正文 @）":""}`;
    if(!autoDeliver)return "自動派送關閉 · 指定收件人後才處理";
    if(modern)return purpose==="discussion"||(purpose==="auto"&&strategy==="discussion")?"按討論策略徵詢成員 · 有界收束":"按工作責任分流 · 無分工時交協調者";
    return `${count} 位成員依次參與 · 可隨時點名`;
  }
  function artifactPageText(part) {
    return String(part.content??"").split("\n").map((line,index)=>{
      const prefix=`${part.startLine+index}: `;
      return line.startsWith(prefix)?line.slice(prefix.length):line;
    }).join("\n");
  }
  function ContractEditor({draft,entries,artifacts,onChange}) {
    const toggle=(list,item,key)=>list.some(value=>key(value)===key(item))?list.filter(value=>key(value)!==key(item)):[...list,item];
    const refs=draft.inputRefs??[],required=draft.requiredWorkIds??[];
    const refKey=ref=>ref.kind==="artifact"?`${ref.artifactId}:${ref.versionId}:${ref.contentHash}`:`${ref.entryId}:${ref.submissionRevision}:${ref.contractHash}`;
    const options=[...(artifacts??[]).flatMap(artifact=>(artifact.versions??[]).filter(version=>version.snapshot?.storage==="immutable-v1").map(version=>({ref:{kind:"artifact",artifactId:artifact.id,versionId:version.id,contentHash:version.contentHash},label:`${artifact.logicalName} · ${version.id.slice(0,8)}`}))),
      ...(entries??[]).filter(entry=>entry.id!==draft.id&&entry.submission?.contractHash&&entry.submission?.revision).map(entry=>({ref:{kind:"work",entryId:entry.id,submissionRevision:entry.submission.revision,contractHash:entry.submission.contractHash},label:`${entry.title} · 第 ${entry.submission.revision} 次提交`}))];
    for(const ref of refs)if(!options.some(option=>refKey(option.ref)===refKey(ref)))options.push({ref,label:`已採用的歷史版本 · ${ref.versionId??ref.entryId}`});
    return h("section",{className:"dclLedgerRecord","aria-label":"工作契約與整合"},
      h("label",null,h("input",{type:"checkbox",checked:Boolean(draft.integration),onChange:event=>onChange({integration:event.target.checked})}),"這是最終整合工作"),
      h("p",{className:"dclFormHint"},"指定材料與提交版本會固定於契約。改動範圍、材料或責任人後須重新驗收。"),
      h("details",null,h("summary",null,`必要子工作 · ${required.length} 項`),
        (entries??[]).filter(entry=>entry.kind==="task"&&entry.id!==draft.id).map(entry=>h("label",{key:entry.id,className:"dclDecisionOption"},h("input",{type:"checkbox",checked:required.includes(entry.id),onChange:()=>onChange({requiredWorkIds:toggle(required,entry.id,id=>id)})}),entry.title)),
        h("p",{className:"dclFormHint"},"這些工作的正式提交必須納入；只加一般關聯不會成為必要子工作。")),
      h("details",null,h("summary",null,`已採用的固定材料 · ${refs.length} 項`),options.length?options.map(option=>h("label",{key:refKey(option.ref),className:"dclDecisionOption"},h("input",{type:"checkbox",checked:refs.some(ref=>refKey(ref)===refKey(option.ref)),onChange:()=>onChange({inputRefs:toggle(refs,option.ref,refKey)})}),option.label)):h("p",null,"尚無固定成果；可先由負責人發布成果，再指定此次採用的版本。")),
      h("label",null,h("input",{type:"checkbox",checked:Boolean(draft.allowPartialDelivery),onChange:event=>onChange({allowPartialDelivery:event.target.checked})}),"契約允許部分交付（仍须列出缺項與影響）"));
  }
  function ArtifactHistory({artifacts,onRead,onReadPath}) {
    return h("div",{"aria-label":"固定成果與歷史版本"},artifacts.slice().reverse().map(artifact=>{
      const fixed=(artifact.versions??[]).filter(version=>version.snapshot?.storage==="immutable-v1");
      const current=artifact.versions?.find(version=>version.id===artifact.currentVersionId);
      return h("div",{key:artifact.id,className:"dclLedgerRecord"},
        h("button",{className:"dclRowButton",onClick:()=>current?.snapshot?.storage==="immutable-v1"?onRead(artifact,current):onReadPath(artifact)},artifact.logicalName),
        h("span",{className:"dclAgentMeta"},`${fixed.length} 個可讀固定版本${fixed.length<(artifact.versions?.length??0)?" · 另有僅路徑登記的舊版本":""}`),
        fixed.length?h("details",null,h("summary",null,"閱讀歷史版本"),fixed.slice().reverse().map(version=>h("button",{key:version.id,className:"dclRowButton",onClick:()=>onRead(artifact,version)},`${version.id===artifact.currentVersionId?"目前 · ":""}${version.observedAt||version.createdAt?new Date(version.observedAt??version.createdAt).toLocaleString():version.id.slice(0,8)} · ${version.contentHash.slice(0,12)}`))):null);
    }));
  }
  function Overview({room, overview, onChanged, onJump, onWork}) {
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
    const [selected,setSelected]=React.useState(null),[resolution,setResolution]=React.useState("");
    const [selectedSources,setSelectedSources]=React.useState([]),[checkedResult,setCheckedResult]=React.useState(false),[disposition,setDisposition]=React.useState("answered");
    const sourcesFor=request=>request?.sourceMessageIds??(request?.triggerEventId&&!request.triggerEventId.startsWith("ledger:")?[request.triggerEventId]:[]);
    const active=["queued","running"].includes(room.orchestration?.state);
    const requests=(overview?.requests??[]).filter(item=>!["resolved","obsolete"].includes(item.state));
    const act=async(path,body)=>{
      if(busy)return;setBusy(true);setError("");
      try{await api(`/rooms/${encodeURIComponent(room.id)}/collaboration/${path}`,{method:"POST",body:JSON.stringify(body)});setSelected(null);setResolution("");
        try{await onChanged?.();}catch{setError("操作已保存，狀態刷新失敗；請刷新，無需重複操作。");}}
      catch(cause){setError(cause.message??String(cause));}finally{setBusy(false);}
    };
    return h("details",{className:"dclRoundStatus","aria-label":"工作概況"},
      h("summary",null,`${outcomeLabel(overview?.outcome)}${overview?.outcome==="accepted"&&overview?.acceptedWithNewEvents?(overview.postAcceptanceIssueCount?" · 新更正／異議待複核":" · 新事件待檢視"):""} · ${overview?.pendingCount??requests.length} 項待處理 · ${overview?.unreviewedCount??0} 項未審閱`),
      h("p",null,"執行停止與工作驗收分開記錄。更正、異議和部分成果均保留。"),
      overview?.acceptedWithNewEvents?h("p",{className:"dclFormHint"},"已驗收的是當時的契約與成果。驗收後新增的訊息仍須檢視；新更正或異議尚未獲得結論。"):null,
      h("label",null,"協作方式 ",h("select",{"aria-label":"協作方式",className:"dclSelect",disabled:busy||active,value:overview?.strategy??"legacy",onChange:event=>void act("policy",{strategy:event.target.value,expectedRevision:overview?.revision})},
        h("option",{value:"work"},"按工作責任分流"),h("option",{value:"discussion"},"有範圍的多人討論"),h("option",{value:"legacy"},"舊版輪流回應"))),
      active?h("p",{className:"dclAgentMeta"},"本輪結束後可切換協作方式。"):null,
      h("label",null,"未分工時交給 ",h("select",{"aria-label":"協調者",className:"dclSelect",disabled:busy||active,value:overview?.coordinatorSessionId??"",onChange:event=>void act("policy",{coordinatorSessionId:event.target.value,expectedRevision:overview?.revision})},h("option",{value:"",disabled:true},"等待指定成員"),(room.members??[]).map(member=>h("option",{key:member.sessionId,value:member.sessionId},member.alias??member.sessionId)))) ,
      (overview?.tasks??[]).map(task=>h("button",{key:task.id,className:"dclRowButton",onClick:()=>onWork?.(task.id)},`${task.title} · ${workLabel(task.status)}${task.submission?.coverage?.missing?.length?` · 尚缺 ${task.submission.coverage.missing.length} 項`:""}`)),
      requests.map(request=>h("div",{key:request.id,className:"dclLedgerMore"},
        h("span",null,`${purposeLabel(request.purpose)} · ${requestLabel(request.state)} · ${room.members?.find(member=>member.sessionId===request.recipient)?.alias??request.recipient??"等待接手"}`),
        request.waitReason?h("p",{className:"dclAgentMeta"},waitLabel(request.waitReason)):null,
        request.currentBasisVersion&&request.currentBasisVersion!==request.basisVersion?h("p",{className:"dclAgentMeta"},"所依契約已更新，原更正或異議仍須明確處置。"):null,
        sourcesFor(request)[0]?h("button",{className:"dclMiniButton",onClick:()=>onJump?.(sourcesFor(request)[0])},"閱讀原請求"):null,
        h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>{setSelected(request);setResolution("");setSelectedSources([]);setCheckedResult(false);setDisposition("answered");}},"記錄處置"))),
      selected?h("div",null,h("label",null,"處置理由（不等於驗收通過）",h("textarea",{className:"dclFormTextArea","aria-label":"請求處置理由",value:resolution,maxLength:4000,onChange:event=>setResolution(event.target.value)})),
        sourcesFor(selected).map((id,index)=>h("div",{key:id},h("button",{className:"dclMiniButton",onClick:()=>onJump?.(id)},`閱讀依據 ${index+1}`),h("label",null,h("input",{type:"checkbox","aria-label":`已核對依據 ${index+1}`,checked:selectedSources.includes(id),disabled:!selectedSources.includes(id)&&selectedSources.length>=50,onChange:event=>setSelectedSources(values=>event.target.checked?[...new Set([...values,id])].slice(0,50):values.filter(value=>value!==id))}),`已核對依據 ${index+1}`))),
        sourcesFor(selected).length>50?h("p",{className:"dclFormHint"},"每次最多核對 50 則，其餘保留待處理。"):null,
        selected.state==="unknown"?h("label",null,h("input",{type:"checkbox","aria-label":"已核對未知執行結果",checked:checkedResult,onChange:event=>setCheckedResult(event.target.checked)}),"已核對原會話的實際結果；此次只記錄核對，不重新執行。"):
          h("label",null,"處置 ",h("select",{"aria-label":"處置方式",className:"dclSelect",value:disposition,onChange:event=>setDisposition(event.target.value)},[["answered","已回答"],["accepted","採納"],["rejected","不採納"],["needs_evidence","尚需證據"]].map(([value,label])=>h("option",{key:value,value},label)))),
        h("button",{className:"dclSecondary",disabled:busy||!resolution.trim()||!selectedSources.length||(selected.state==="unknown"&&!checkedResult),onClick:()=>void act("resolve",{requestId:selected.id,expectedRevision:selected.revision,resolution:{disposition:selected.state==="unknown"?"result_checked":disposition,summary:resolution.trim()},sourceMessageIds:selectedSources})},"保存處置"),
        h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>setSelected(null)},"取消")):null,
      overview?.budget?h("details",null,h("summary",null,"本次執行額度"),h("p",null,`每次工作最多喚醒 ${overview.budget.maxExecutions??"依房間設定"} 次；每位成員最多 ${overview.budget.maxPerMember??"依房間設定"} 次。`),h("p",null,`保留 ${overview.budget.integrationReserve??1} 次整合、${overview.budget.reviewReserve??1} 次驗收。`),(overview.budgetAccounts??[]).slice(-1).map(account=>h("p",{key:account.id},`目前已使用 ${account.reservations?.filter(item=>item.state!=="released").length??0} / ${account.maxExecutions} 次；模型內部重試和 token 用量尚無宿主回報。`)),h("p",null,"跳過、重試及結果未知的喚醒也計入；內部交接不重置額度。")):null,
      error?h("p",{className:"dclError",role:"alert"},error):null);
  }
  return {Overview,ContractEditor,ArtifactHistory,outcomeLabel,audienceLabel,artifactPageText};
}
