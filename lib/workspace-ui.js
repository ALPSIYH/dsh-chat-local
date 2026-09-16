// Generated into the native client bundle by build-client.mjs.
export function createWorkspaceComposer(React,h,api,ctx,TeamUI={}) {
  const fields=draft=>Object.fromEntries(["title","text","members","environment","charter","autoDeliver","mode","rosterSource"].filter(key=>draft[key]!==undefined).map(key=>[key,draft[key]]));
  return function WorkspaceComposer({initial,rosters=[],groups=[],onClose,onComplete,onRosterSaved,onDraftSaved,navigationToken}) {
    const localKey=`dcl:workspace-draft:${initial.id}`;
    const initialState=()=>{try{const local=JSON.parse(localStorage.getItem(localKey)??"null");if(local&&!initial.start&&local.data?.id===initial.id){
      if(local.revision===initial.revision)return local;
      if(local.pending?.body?.operationId&&local.pending.body.operationId===initial.lastSave?.operationId)return {...local,revision:initial.revision,saved:local.pending.version,pending:null,data:{...local.data,revision:initial.revision}};
      if(local.pending||local.change>local.saved)return {...local,conflict:true,server:initial};
    }}catch{}return {data:initial,revision:initial.revision,change:0,saved:0,pending:null};};
    const ref=React.useRef(null);if(!ref.current)ref.current=initialState();
    const [data,setData]=React.useState(ref.current.data),[status,setStatus]=React.useState(initial.ephemeral?"尚未開始 · 輸入後自動保存":"已保存草稿"),[error,setError]=React.useState("");
    const [catalog,setCatalog]=React.useState(null),[modelError,setModelError]=React.useState("");
    const [busy,setBusy]=React.useState(false),[checks,setChecks]=React.useState([]),[teamOpen,setTeamOpen]=React.useState(!initial.members.length),[environmentOpen,setEnvironmentOpen]=React.useState(false),[conflict,setConflict]=React.useState(Boolean(ref.current.conflict));
    const [rosterName,setRosterName]=React.useState(""),[confirmRisk,setConfirmRisk]=React.useState(false),[discard,setDiscard]=React.useState(false);
    const [picker,setPicker]=React.useState(null),[editor,setEditor]=React.useState(null),[copyOpen,setCopyOpen]=React.useState(false);
    const promiseRef=React.useRef(null),alive=React.useRef(true),busyRef=React.useRef(false),rosterReceipt=React.useRef(null);
    const cache=()=>{try{localStorage.setItem(localKey,JSON.stringify(ref.current));return true;}catch{if(alive.current)setStatus("本机暂存不可用；请等待服务器保存成功");return false;}};
    const flush=async()=>{
      if(promiseRef.current)return promiseRef.current;
      const task=(async()=>{
        if(ref.current.conflict)throw new Error("本机稿与服务器版本不同；请先选择保留哪一份，未丢弃任何输入");
        while(!ref.current.discarding&&(ref.current.pending||ref.current.saved<ref.current.change)){
          if(!ref.current.pending)ref.current.pending={version:ref.current.change,body:{...fields(ref.current.data),...(initial.ephemeral?{seed:{kind:initial.kind,groupId:initial.groupId}}:{}),expectedRevision:ref.current.revision,operationId:crypto.randomUUID()}};
          cache();if(alive.current)setStatus("保存中…");
          const pending=ref.current.pending;
          let next;
          try{next=await api(`/drafts/${encodeURIComponent(initial.id)}`,{method:"POST",body:JSON.stringify(pending.body)});}catch(cause){
            if(cause.status===400){ref.current.pending=null;cache();}
            if(cause.status===409){ref.current.conflict=true;cache();if(alive.current)setConflict(true);}
            throw cause;
          }
          ref.current.revision=next.revision;ref.current.saved=pending.version;ref.current.pending=null;
          ref.current.data={...ref.current.data,ephemeral:false,revision:next.revision};cache();
          if(alive.current){setData({...ref.current.data});onDraftSaved?.({...ref.current.data});setError("");setStatus("已保存草稿");}
        }
        return ref.current.data;
      })();promiseRef.current=task;
      try{return await task;}catch(cause){if(alive.current){setError(cause.message??String(cause));setStatus("未确认保存 · 输入已留在本机");}throw cause;}finally{promiseRef.current=null;}
    };
    const update=(patch,internal=false)=>{if(busyRef.current&&!internal||initial.start)return;ref.current.data={...ref.current.data,...patch};ref.current.change++;cache();setData({...ref.current.data});setStatus("待保存…");setChecks([]);setError("");if(patch.environment||patch.mode||patch.members)setConfirmRisk(false);};
    React.useEffect(()=>{const timer=setTimeout(()=>void flush().catch(()=>{}),450);return()=>clearTimeout(timer);},[data]);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;void flush().catch(()=>{});};},[]);
    const loadModels=async()=>{setModelError("");try{const result=await ctx.remote.session.modelCatalog();if(!result.ok)throw new Error(result.error?.message??"DSH 模型目录暂不可用");if(alive.current)setCatalog(result.value);}catch(cause){if(alive.current)setModelError(cause.message??String(cause));}};
    React.useEffect(()=>{void loadModels();},[]);
    const choices=(catalog?.groups??[]).flatMap(group=>group.models.map(model=>({group,model,key:JSON.stringify([group.id,model.id])})));
    const mutateMember=(id,patch)=>update({members:data.members.map(member=>member.id===id?{...member,...patch}:member)});
    const run=async(action)=>{
      if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");
      try{await flush();await action();}catch(cause){if(alive.current)setError(cause.message??String(cause));}finally{busyRef.current=false;if(alive.current)setBusy(false);}
    };
    const finish=async(saveOnly=false)=>{
      const completionToken=navigationToken;
      const current=ref.current.data;
      if(current.kind==="group"){
        const group=await api("/groups",{method:"POST",body:JSON.stringify({operationId:`group-draft:${initial.id}`,draftId:initial.id,expectedRevision:ref.current.revision,name:current.title,members:current.members.filter(member=>member.enabled),environment:current.environment,mode:current.mode,autoDeliver:current.autoDeliver,charter:current.charter})});
        try{localStorage.removeItem(localKey);}catch{}if(alive.current)await onComplete({group,saveOnly},completionToken);
      }else {
        const result=await api(`/drafts/${encodeURIComponent(initial.id)}/start`,{method:"POST",body:JSON.stringify({expectedRevision:ref.current.revision,confirmRisk})});
        if(result.state==="needs_configuration"){if(alive.current){setChecks(result.checks);setTeamOpen(true);setEnvironmentOpen(result.checks.some(check=>check.kind==="environment"));setStatus("请处理本次配置");}return;}
        try{localStorage.removeItem(localKey);}catch{}if(alive.current)await onComplete(result,completionToken);
      }
    };
    const selected=data.members.filter(member=>member.enabled),environmentPaths=[...new Set(selected.map(member=>data.environment.overrides?.[member.id]??data.environment.cwd).filter(Boolean))];
    const risk=data.kind!=="group"&&["inherit_dsh","workspace_write","full_access"].includes(data.mode)&&!initial.start;
    const failed=checks.filter(check=>!check.ok&&check.kind!=="environment"),environmentFailed=checks.filter(check=>!check.ok&&check.kind==="environment");
    const resolveConflict=async useLocal=>{try{const latest=(await api("/workspace")).drafts.find(item=>item.id===initial.id);if(!latest)throw new Error("服务器草稿已开始或移除；本机内容保留，请复制后返回");ref.current={data:useLocal?{...ref.current.data,revision:latest.revision}:latest,revision:latest.revision,change:useLocal?1:0,saved:0,pending:null};cache();setConflict(false);setData({...ref.current.data});setError("");}catch(cause){setError(cause.message);}};
    const discardNow=async()=>{
      if(busyRef.current)return;busyRef.current=true;setBusy(true);ref.current.discarding=true;
      try{
        await promiseRef.current?.catch(()=>{});
        if(ref.current.data.ephemeral&&!ref.current.pending&&ref.current.saved===0){ref.current.saved=ref.current.change;try{localStorage.removeItem(localKey);}catch{}if(alive.current)onClose();return;}
        const latest=(await api("/workspace")).drafts.find(item=>item.id===initial.id);
        if(!latest)throw new Error("草稿已经开始或移除，请查看服务器结果");
        if(latest.revision!==ref.current.revision&&(!ref.current.pending?.body?.operationId||latest.lastSave?.operationId!==ref.current.pending.body.operationId))throw new Error("草稿在别处已更新，请先比较内容后再舍弃");
        await api(`/drafts/${encodeURIComponent(initial.id)}`,{method:"DELETE",body:JSON.stringify({expectedRevision:latest.revision})});
        ref.current.saved=ref.current.change;ref.current.pending=null;try{localStorage.removeItem(localKey);}catch{}if(alive.current)onClose();
      }catch(cause){ref.current.discarding=false;setError(cause.message);}finally{busyRef.current=false;if(alive.current)setBusy(false);}
    };
    const isGroup=data.kind==="group";
    const titleField=h("label",{className:"dclFormField"},isGroup?"群組名稱":"對話主題（選填）",h("input",{className:"dclInput",autoFocus:isGroup,value:data.title,maxLength:120,disabled:busy||Boolean(initial.start),onChange:event=>update({title:event.target.value}),placeholder:isGroup?"例如：研究工作室":"未填時從第一條消息產生"}));
    const summaryOf=value=>h("div",{className:"dclConflictSummary"},h("strong",null,value.title||"未命名"),h("p",null,value.text||"尚無討論內容"),h("p",null,(value.members??[]).filter(m=>m.enabled).map(m=>m.alias||"未命名成員").join("、")||"零位參與者"),h("small",null,value.environment?.cwd||"未選擇目錄"," · ",value.mode));
    const environmentInput=TeamUI.DirectoryField?h(TeamUI.DirectoryField,{label:isGroup?"未來對話的工作目錄":"本次工作目錄",value:data.environment.cwd,disabled:busy,onChange:cwd=>update({environment:{...data.environment,cwd,overrides:{}}})}):h("input",{className:"dclInput",value:data.environment.cwd,disabled:busy,onChange:event=>update({environment:{...data.environment,cwd:event.target.value,overrides:{}}}),placeholder:"选择一个已有工作目录的完整路径"});
    return h("section",{className:"dclStartWorkspace "+(isGroup?"dclGroupCreate":"dclTopicCreate"),"aria-label":isGroup?"建立群組":"新對話草稿"},
      h("header",{className:"dclStartHeader"},h("div",null,h("span",{className:"dclEyebrow"},isGroup?"新的團隊":"新的話題"),h("h2",null,isGroup?"組建你的團隊":"這次想討論什麼？"),h("p",null,isGroup?"從空白開始，可混用已有與新建 Agent。保存群組不會啟動工作。":"先寫下事情。參與者、資料與工作進度都只屬於這段對話。")),h("button",{className:"dclSecondary",disabled:busy,onClick:()=>void run(async()=>onClose())},"返回 · 保留草稿")),
      conflict?h("section",{className:"dclNotice dclDraftConflict",role:"alert"},h("p",null,"本機輸入與伺服器版本不同。先比較，再選擇；尚未覆蓋任何內容。"),h("div",{className:"dclConflictColumns"},h("section",null,h("h4",null,"目前輸入"),summaryOf(data)),h("section",null,h("h4",null,"伺服器版本"),summaryOf(ref.current.server??initial))),h("button",{className:"dclSecondary",onClick:()=>void resolveConflict(true)},"保留本机稿并另行同步"),h("button",{className:"dclSecondary",onClick:()=>void resolveConflict(false)},"明确使用服务器版本")):null,
      isGroup?titleField:h(React.Fragment,null,h("label",{className:"dclFormField dclTopicPrompt"},"討論內容",h("textarea",{className:"dclFormTextArea dclStartText",autoFocus:true,value:data.text,disabled:busy||Boolean(initial.start),onChange:event=>update({text:event.target.value}),placeholder:"描述這次要討論或完成的事情…",onKeyDown:event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter"&&!event.nativeEvent?.isComposing){event.preventDefault();if(!busy&&(!risk||confirmRisk)&&data.text.trim())void run(()=>finish());}}})),h("details",{className:"dclTopicTitle"},h("summary",null,data.title?"主題："+data.title:"設定對話主題（選填）"),titleField)),
      h("section",{className:"dclTeamSummarySection","aria-label":isGroup?"群組成員":"本次參與者"},
        h("div",{className:"dclSectionHeading"},h("div",null,h("h3",null,isGroup?"群組成員":"本次參與者",h("span",{className:"dclCount"},selected.length)),h("p",{className:"dclAgentMeta"},isGroup?"建立後可在群組設定調整新對話的預選名單。":initial.groupId?"初始沿用群組預選；這裡調整只影響本次。":"可自由組隊；不需先建立群組。")),h("button",{className:"dclSecondary",disabled:busy||Boolean(initial.start),onClick:()=>setPicker("existing")},isGroup?"加入已有 Agent":"調整參與者")),
        selected.length?h("div",{className:"dclSelectedCards"},selected.map(member=>h("article",{className:"dclSelectedCard",key:member.id},h("span",{className:"dclSelectedAvatar","aria-hidden":true},(member.alias||"A").slice(0,1)),h("div",{className:"dclSelectedInfo"},h("strong",null,member.alias||"尚未命名"),h("span",null,member.role||"職務未設定"),h("small",null,member.context?"接續原生上下文":member.model?.model?(member.model.provider+" / "+member.model.model):"模型待選",!member.agentId?" · 新 Agent，提交後建立":"")),h("div",{className:"dclSelectedActions"},h("button",{className:"dclMiniButton",disabled:busy||Boolean(initial.start),"aria-label":"編輯 "+member.alias,onClick:()=>setEditor(member)},"編輯"),h("button",{className:"dclMiniButton",disabled:busy||Boolean(initial.start),"aria-label":"移出 "+member.alias,onClick:()=>mutateMember(member.id,{enabled:false})},"移出"))))):h("div",{className:"dclTeamEmpty"},h("strong",null,isGroup?"先加幾位夥伴，也可以稍後再組隊":"尚未選擇參與者"),h("p",null,isGroup?"空群組可以正常建立，不會自動加入其他群組的人。":"沒有 Agent 時，這次內容會保存為筆記。")),
        h("div",{className:"dclInlineActions"},h("button",{className:"dclSecondary",disabled:busy||Boolean(initial.start),onClick:()=>setPicker("new")},"＋ 建立新 Agent"),
          isGroup?h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>setCopyOpen(!copyOpen),"aria-expanded":copyOpen},"從其他群組複製成員…"):null),
        data.members.some(m=>!m.enabled)?h("details",{className:"dclCandidateRemainder"},h("summary",null,"未選候選 · "+data.members.filter(m=>!m.enabled).length),h("p",{className:"dclAgentMeta"},"保留配置，不參加本次；不影響群組或其他對話。"),data.members.filter(m=>!m.enabled).map(member=>h("button",{key:member.id,className:"dclMiniButton",disabled:busy,onClick:()=>mutateMember(member.id,{enabled:true})},"加入 "+(member.alias||"未命名")))):null,
        copyOpen?h("label",{className:"dclFormField"},"只複製成員配置，不帶入聊天、目錄或權限",h("select",{className:"dclSelect",value:"",disabled:busy,onChange:event=>{const id=event.target.value;if(id)void run(async()=>{const config=await api("/groups/"+encodeURIComponent(id)+"/configuration?all=true");update({members:config.members.map(m=>({...m,enabled:true})),rosterSource:{name:groups.find(g=>g.id===id)?.name??"所選群組"}},true);setCopyOpen(false);});}},h("option",{value:""},"選擇來源群組…"),groups.filter(g=>!g.archivedAt&&!g.deletedAt).map(g=>h("option",{key:g.id,value:g.id},g.name)))):null,
        rosters.length?h("details",{className:"dclCandidateRemainder"},h("summary",null,"已有常用組合"),h("p",{className:"dclAgentMeta"},"選取後在選人面板中核對；不替换工作環境。"),rosters.map(roster=>h("button",{key:roster.id,className:"dclMiniButton",disabled:busy,onClick:()=>setPicker({mode:"existing",members:structuredClone(roster.members),name:roster.name})},roster.name))):null),
      h("details",{className:"dclStartEnvironment",open:environmentOpen,onToggle:event=>setEnvironmentOpen(event.currentTarget.open)},h("summary",null,(isGroup?"群組預設（選填）":"本次工作環境")+" · "+(environmentPaths.length>1?environmentPaths.length+" 個目錄":environmentPaths[0]?.split("/").filter(Boolean).at(-1)||"未選擇目錄")+" · "+({discuss_only:"只讀討論",read_only_audit:"只讀審計",inherit_dsh:"遵循 DSH",workspace_write:"工作區修改",full_access:"完整權限"})[data.mode]),
        environmentInput,
        environmentPaths.length>1?h("p",{className:"dclAgentMeta"},selected.map(member=>member.alias+"："+(data.environment.overrides?.[member.id]??data.environment.cwd)).join("；"),"。選擇統一目錄後會替換這些逐成員目錄。"):null,
        h("label",{className:"dclFormField"},isGroup?"新對話的權限預設":"本次權限",h("select",{className:"dclSelect",value:data.mode,disabled:busy,onChange:event=>update({mode:event.target.value})},Object.entries({discuss_only:"只讀討論",read_only_audit:"只讀審計",inherit_dsh:"遵循 DSH",workspace_write:"允許工作區修改",full_access:"完整權限"}).map(([value,label])=>h("option",{value,key:value},label)))),
        h("label",{className:"dclFormField"},isGroup?"群組共同約定（供未來對話使用）":"本次共同約定（不修改群組預設）",h("textarea",{className:"dclFormTextArea",value:data.charter,disabled:busy,onChange:event=>update({charter:event.target.value}),placeholder:"可留空，之後可由成員從討論提出修訂。"}))),
      h("label",{className:"dclAutoCollaboration"},h("input",{type:"checkbox",checked:data.autoDeliver,disabled:busy||Boolean(initial.start),onChange:event=>update({autoDeliver:event.target.checked})}),isGroup?"新對話預設自動協作":"自動協作",h("small",null,isGroup?"不會因建立群組而喚醒 Agent":"發送後允許成員互相 @ 接續工作")),
      risk?h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:confirmRisk,disabled:busy,onChange:event=>setConfirmRisk(event.target.checked)}),data.mode==="inherit_dsh"?"確認沿用 DSH 的原生權限；實際可讀寫範圍由各會話設定決定。":data.mode==="workspace_write"?"確認允許在本次工作目錄內修改檔案；若接續原生會話，也會同步該會話權限。":"確認本次使用完整權限：可執行命令與修改檔案；若接續原生會話，也會同步該會話權限。"):null,
      checks.some(c=>!c.ok)?h("section",{className:"dclPreflightIssues",role:"alert"},h("h3",null,"還有幾項設定需要處理"),checks.filter(c=>!c.ok).map(check=>h("div",{key:check.id},h("strong",null,check.alias),h("p",null,check.error),h("button",{className:"dclSecondary",onClick:()=>check.kind==="environment"?setEnvironmentOpen(true):check.kind==="context"?setPicker("native"):setEditor(data.members.find(m=>m.id===check.id))},check.kind==="environment"?"選擇目錄":check.kind==="context"?"重新選擇會話":"調整成員"),h("button",{className:"dclMiniButton",onClick:()=>mutateMember(check.id,{enabled:false})},"本次不加入")))):null,
      error?h("div",{className:"dclError",role:"alert"},error,h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>void flush().catch(()=>{})},"重试保存"),h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>{if(cache())onClose();}},"仅保留本机稿并返回")):null,
      initial.start?h("p",{className:"dclNotice"},"此草稿已有開始記錄。繼續會核對已保存的對話，不會盲目重播未知結果。"):null,
      h("footer",{className:"dclStartActions"},h("span",{className:"dclAgentMeta",role:"status"},status),h("button",{className:"dclMiniButton",disabled:busy||Boolean(initial.start),onClick:()=>setDiscard(!discard)},"捨弃草稿"),h("button",{className:"dclPrimary",disabled:busy||conflict||risk&&!confirmRisk||(isGroup?!data.title.trim():!data.text.trim()),onClick:()=>void run(()=>finish(false))},busy?"處理中…":isGroup?"建立群組":initial.start?"查看開始結果":selected.length?(data.autoDeliver?"發送並開始":"保存待討論內容"):"保存笔记")),
      !isGroup?h("small",{className:"dclShortcut"},"⌘ / Ctrl + Enter 發送 · Enter 換行"):null,
      discard?h("div",{className:"dclMemoryConfirm",role:"group","aria-label":"确认舍弃草稿"},h("p",null,"捨棄這份未開始的草稿？草稿內的新 Agent 尚未發布，一併捨棄；既有 Agent、其他對話及 DSH 會話不受影響。"),h("button",{className:"dclDanger",disabled:busy,onClick:()=>void discardNow()},"确认舍弃"),h("button",{className:"dclSecondary",onClick:()=>setDiscard(false)},"繼續編輯")):null,
      picker&&TeamUI.ParticipantPicker?h(TeamUI.ParticipantPicker,{members:typeof picker==="object"?picker.members:data.members,groupMembers:initial.kind==="conversation"?initial.members:[],target:{kind:isGroup?"group-draft":"conversation-draft",id:initial.id},initialMode:typeof picker==="string"?picker:picker.mode,onClose:()=>setPicker(null),onApply:members=>{update({members,...(picker.name?{rosterSource:{name:picker.name}}:{})});setPicker(null);}}):null,
      editor&&TeamUI.AgentEditor?h(TeamUI.Dialog,{title:"編輯參與者",onClose:()=>setEditor(null)},h(TeamUI.AgentEditor,{initial:editor,scope:isGroup?"只調整這個群組；不改 Agent 名冊":"只調整本次；不改群組或 Agent 名冊",submitLabel:"保存本次配置",onCancel:()=>setEditor(null),onSave:member=>{mutateMember(editor.id,member);setEditor(null);}})):null);
  };
}
