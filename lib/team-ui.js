// Self-contained factory: build-client serializes this function into the native bundle.
export function createTeamUI(React,h,api,ctx) {
  const clone=value=>structuredClone(value);
  const message=error=>error?.message??String(error);
  const modelText=model=>model?.provider&&model?.model?`${model.provider} / ${model.model}`:"模型待設定";
  const composing=event=>event.isComposing||event.nativeEvent?.isComposing||event.keyCode===229;
  const button=(label,onClick,extra={})=>h("button",{type:"button",className:"dclSecondary",onClick,...extra},label);

  function Dialog({title,onClose,onEscape=onClose,busy,children,focusKey}) {
    const root=React.useRef(null),previous=React.useRef(null),ime=React.useRef(false);
    React.useEffect(()=>{
      if(typeof document==="undefined")return;
      previous.current=document.activeElement;
      const changed=[];let child=root.current?.parentElement;
      while(child&&child!==document.body){for(const sibling of child.parentElement?.children??[]){if(sibling!==child&&!sibling.inert){sibling.inert=true;changed.push(sibling);}}child=child.parentElement;}
      return()=>{for(const element of changed)element.inert=false;if(previous.current?.isConnected)previous.current.focus({preventScroll:true});};
    },[]);
    React.useEffect(()=>{(root.current?.querySelector('[data-dcl-initial-focus="true"]')??root.current?.querySelector("input,button"))?.focus({preventScroll:true});},[focusKey]);
    const keyboard=event=>{
      if(event.defaultPrevented)return;
      if(composing(event)||ime.current){event.stopPropagation();return;}
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(!busy)onEscape();}
      if(event.key==="Tab"&&root.current&&typeof document!=="undefined"){
        event.stopPropagation();
        const controls=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(element=>element.getClientRects().length),first=controls[0],last=controls.at(-1);
        if(!first){event.preventDefault();root.current.focus();}
        else if(event.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    return h("div",{className:"dclTeamBackdrop"},h("section",{className:"dclTeamDialog",ref:root,role:"dialog","aria-modal":true,"aria-label":title,"aria-busy":busy,tabIndex:-1,onKeyDown:keyboard,onCompositionStart:()=>{ime.current=true;},onCompositionEnd:()=>{ime.current=false;}},h("header",{className:"dclTeamHeader"},h("h2",null,title),button("關閉",onClose,{className:"dclMiniButton",disabled:busy,"aria-label":`關閉${title}`})),children));
  }

  function AgentEditor({initial={},onSave,onCancel,submitLabel="加入草稿",scope="本次草稿"}) {
    const [profile,setProfile]=React.useState(()=>({...clone(initial),alias:initial.alias??"",role:initial.role??"",mandate:initial.mandate??"",model:clone(initial.model??{provider:"",model:""})}));
    const [catalog,setCatalog]=React.useState(null),[query,setQuery]=React.useState(""),[error,setError]=React.useState(""),[catalogError,setCatalogError]=React.useState(""),[busy,setBusy]=React.useState(false);
    const lock=React.useRef(false),alive=React.useRef(true),ime=React.useRef(false);
    const newBlankProfile=!initial.id&&!initial.agentId&&initial.revision===undefined&&!String(initial.alias??"").trim()&&!String(initial.role??"").trim()&&!String(initial.mandate??"").trim()&&!initial.context&&!initial.nativeImport;
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const load=async()=>{setCatalogError("");try{const result=await ctx.remote?.session?.modelCatalog?.();if(!result?.ok)throw new Error(result?.error?.message??"DSH 模型目錄暫不可用");if(!alive.current)return;setCatalog(result.value);const d=result.value.default,valid=(result.value.groups??[]).some(group=>group.id===d?.provider&&group.models?.some(model=>model.id===d?.model));if(valid&&newBlankProfile&&!initial.lockedModel)setProfile(current=>current.model?.provider||current.model?.model?current:{...current,model:clone(d)});}catch(cause){if(alive.current)setCatalogError(message(cause));}};
    React.useEffect(()=>{void load();},[]);
    const groups=catalog?.groups??[],choices=groups.flatMap(group=>(group.models??[]).map(model=>({group,model,key:JSON.stringify([group.id,model.id])}))),current=choices.find(item=>item.group.id===profile.model.provider&&item.model.id===profile.model.model);
    const update=patch=>{if(!lock.current){setProfile(value=>({...value,...patch}));setError("");}};
    const save=async event=>{event?.preventDefault?.();if(lock.current||ime.current||composing(event??{}))return;if(!profile.alias.trim()){setError("請填寫 Agent 名稱。");return;}lock.current=true;setBusy(true);setError("");try{await onSave({...clone(profile),alias:profile.alias.trim()});}catch(cause){if(alive.current)setError(message(cause));}finally{lock.current=false;if(alive.current)setBusy(false);}};
    return h("form",{className:"dclTeamEditor",onSubmit:save,"aria-label":"編輯 Agent","aria-busy":busy,onCompositionStart:()=>{ime.current=true;},onCompositionEnd:()=>{ime.current=false;},onKeyDown:event=>{if(composing(event)||ime.current){if(event.key==="Enter")event.preventDefault();event.stopPropagation();return;}if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(!lock.current)onCancel();}}},
      h("h3",null,initial.alias?`編輯 ${initial.alias}`:"新建 Agent"),h("p",{className:"dclAgentMeta"},`修改範圍：${scope}`),
      h("label",{className:"dclFormField"},"名稱",h("input",{className:"dclInput",value:profile.alias,"aria-label":"Agent 名稱","data-dcl-initial-focus":true,autoFocus:true,maxLength:120,disabled:busy,onChange:event=>update({alias:event.target.value}),placeholder:"例如：方法顧問"})),
      h("label",{className:"dclFormField"},"職務 · 選填",h("input",{className:"dclInput",value:profile.role,"aria-label":"Agent 職務",maxLength:1000,disabled:busy,onChange:event=>update({role:event.target.value}),placeholder:"例如：研究設計與核查"})),
      h("div",{className:"dclTeamModel"},h("label",{className:"dclFormField"},"模型",h("input",{className:"dclInput",value:query,"aria-label":"搜尋模型",placeholder:"搜尋供應商或模型…",disabled:busy||Boolean(initial.lockedModel),onChange:event=>setQuery(event.target.value)}),h("select",{className:"dclSelect","aria-label":"Agent 模型",value:JSON.stringify([profile.model.provider??"",profile.model.model??""]),disabled:busy||!catalog||Boolean(initial.lockedModel),onChange:event=>{if(initial.lockedModel)return;const item=choices.find(choice=>choice.key===event.target.value);if(item)update({model:{provider:item.group.id,model:item.model.id,...(item.model.reasoning?.defaultEffort?{reasoningEffort:item.model.reasoning.defaultEffort}:{})}});}},
        !current?h("option",{value:JSON.stringify([profile.model.provider??"",profile.model.model??""])},profile.model.model?`${modelText(profile.model)} · 待核驗`:"模型待設定 · 不會自動選清單第一項"):null,
        groups.map(group=>h("optgroup",{key:group.id,label:group.name??group.id},(group.models??[]).filter(model=>model.id===profile.model.model&&group.id===profile.model.provider||`${group.name??group.id} ${model.name??model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(model=>h("option",{key:model.id,value:JSON.stringify([group.id,model.id])},`${model.name??model.id}`)))))),
        !catalog&&!catalogError?h("p",{role:"status",className:"dclAgentMeta"},"正在讀取 DSH 模型目錄；仍可填寫名稱。"):null,
        catalogError?h("div",{className:"dclError",role:"alert"},catalogError,button("重試模型目錄",()=>void load(),{disabled:busy})):null,
        current?.model.reasoning?.efforts?.length?h("label",{className:"dclFormField"},"推理強度",h("select",{className:"dclSelect","aria-label":"Agent 推理強度",value:profile.model.reasoningEffort??current.model.reasoning.defaultEffort??"",disabled:busy||Boolean(initial.lockedModel),onChange:event=>{if(!initial.lockedModel)update({model:{...profile.model,reasoningEffort:event.target.value}});}},current.model.reasoning.efforts.map(effort=>h("option",{key:effort.id,value:effort.id},effort.name??effort.id)))):null,
        initial.lockedModel?h("p",{className:"dclNotice"},initial.context?.kind==="continue"?"接續會話沿用原生模型。需要換模型請返回並改用獨立上下文。":"已開始對話的模型請在參與者面板調整"):null,
        h("p",{className:"dclAgentMeta"},"模型尚未選定也可保存配置；開始討論前才核驗。目錄與權限在群組／對話中設定。")),
      h("details",null,h("summary",null,"職責與背景要求 · 選填"),h("textarea",{className:"dclFormTextArea","aria-label":"Agent 職責",value:profile.mandate,maxLength:8000,disabled:busy,onChange:event=>update({mandate:event.target.value}),placeholder:"可稍後在討論中分配工作"})),
      error?h("p",{className:"dclError",role:"alert"},error):null,
      h("footer",{className:"dclTeamActions"},button("取消",onCancel,{disabled:busy}),h("button",{type:"submit",className:"dclPrimary",disabled:busy||!profile.alias.trim()},busy?"保存中…":submitLabel)));
  }

  function ParticipantPicker({members=[],onApply,onClose,target,groupMembers=[],initialMode="existing",extraContent}) {
    const [buffer,setBuffer]=React.useState(()=>clone(members)),[profiles,setProfiles]=React.useState([]),[loading,setLoading]=React.useState(true),[query,setQuery]=React.useState(""),[filter,setFilter]=React.useState("all");
    const [editing,setEditing]=React.useState(()=>initialMode==="new"?{}:null),[error,setError]=React.useState(""),[loadFailed,setLoadFailed]=React.useState(false),[busy,setBusy]=React.useState(false);
    const [nativeOpen,setNativeOpen]=React.useState(initialMode==="native"),[nativeQuery,setNativeQuery]=React.useState(""),[preview,setPreview]=React.useState(null),[sessionState,setSessionState]=React.useState(()=>{try{return ctx.sessions?.list?.getSnapshot?.()??null;}catch{return null;}});
    const lock=React.useRef(false),alive=React.useRef(true),listRef=React.useRef(null),scroll=React.useRef(0),newButton=React.useRef(null),editButtons=React.useRef(new Map()),nativeButton=React.useRef(null),returnFocus=React.useRef(null);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const load=async()=>{setLoading(true);setError("");setLoadFailed(false);try{const data=await api("/agents?archived=true");if(alive.current)setProfiles(Array.isArray(data)?data:data.agents??data.profiles??[]);}catch(cause){if(alive.current){setLoadFailed(true);setError(`無法讀取 Agent 名冊：${message(cause)}。已選名單保留。`);}}finally{if(alive.current)setLoading(false);}};
    React.useEffect(()=>{void load();},[]);
    React.useEffect(()=>ctx.sessions?.list?.subscribe?.(()=>{try{setSessionState(ctx.sessions.list.getSnapshot());}catch{}}),[]);
    const run=async action=>{if(lock.current)return;lock.current=true;setBusy(true);setError("");setLoadFailed(false);try{await action();}catch(cause){if(alive.current)setError(message(cause));}finally{lock.current=false;if(alive.current)setBusy(false);}};
    const selected=buffer.filter(member=>member.enabled!==false),groupIds=new Set(groupMembers.map(member=>member.agentId??member.id));
    const candidateMap=new Map();for(const member of groupMembers)candidateMap.set(member.agentId??member.id,{...member,model:member.model??member.config?.model,id:member.agentId??member.id,fromGroup:true});for(const profile of profiles){const local=candidateMap.get(profile.id);candidateMap.set(profile.id,{...profile,...local,id:profile.id,archivedAt:profile.archivedAt,fromGroup:groupIds.has(profile.id)});}for(const member of buffer){const id=member.agentId??member.id;if(!candidateMap.has(id))candidateMap.set(id,{...member,id,fromGroup:groupIds.has(id),fromDraft:!member.agentId});}
    const candidatePool=[...candidateMap.values()].filter(profile=>!profile.archivedAt||profile.fromGroup),names=new Map();
    for(const profile of candidatePool){const name=String(profile.alias??"").trim().toLocaleLowerCase();names.set(name,(names.get(name)??0)+1);}
    const identityText=id=>String(id).replace(/^(?:legacy-)?agent-/u,"").replaceAll("-","");
    const shortIdentity=profile=>{const raw=identityText(profile.id);let length=8;while(length<raw.length&&candidatePool.some(other=>other.id!==profile.id&&identityText(other.id).slice(-length)===raw.slice(-length)))length+=4;return raw.slice(-length);};
    const sourceHint=profile=>{const groups=Array.isArray(profile.usages)?profile.usages:profile.usages?.groups??[],source=groups.find(group=>group.id===profile.source?.groupId);if(source?.name)return `來源群組：${source.name}`;if(groups.some(group=>group.name))return `使用群組：${groups.filter(group=>group.name).map(group=>group.name).join("、")}`;return profile.fromGroup?"本群組":profile.fromDraft?"本次草稿":"群組來源未提供";};
    const candidates=candidatePool.filter(profile=>(filter!=="group"||profile.fromGroup)&&`${profile.alias??""} ${profile.role??""} ${profile.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const match=(member,profile)=>member.agentId===profile.id||member.id===profile.id;
    const choose=profile=>void run(async()=>{
      const found=buffer.find(member=>match(member,profile));
      if(found){setBuffer(current=>current.map(member=>member.id===found.id?{...member,enabled:member.enabled===false}:member));return;}
      if(buffer.length>=32)throw new Error("每份成員配置最多 32 位；請先移出不需要的候選配置。已選名單保留。");
      const local=groupMembers.find(member=>(member.agentId??member.id)===profile.id);
      const value=local?{...clone(local),model:clone(local.model??local.config?.model??{provider:"",model:""})}:await api(`/agents/${encodeURIComponent(profile.id)}/selection`);
      const member=value.member??value;
      if(alive.current)setBuffer(current=>current.some(item=>item.agentId&&item.agentId===member.agentId)?current:[...current,clone({...member,enabled:true})]);
    });
    const openEditor=member=>{scroll.current=listRef.current?.scrollTop??0;returnFocus.current=member?.id??(nativeOpen?"native":"new");setEditing(clone(member??{}));};
    const closeEditor=()=>{setEditing(null);setTimeout(()=>{if(!alive.current)return;if(listRef.current)listRef.current.scrollTop=scroll.current;const focus=returnFocus.current==="new"?newButton.current:returnFocus.current==="native"?nativeButton.current:editButtons.current.get(returnFocus.current);focus?.focus({preventScroll:true});},0);};
    const saveEdited=profile=>{
      if(!profile.alias?.trim())throw new Error("請填寫 Agent 名稱。");
      if(!profile.id&&buffer.length>=32)throw new Error("每份成員配置最多 32 位；請先移出不需要的候選配置。");
      const next={...clone(profile),id:profile.id??crypto.randomUUID(),revision:profile.revision??1,enabled:true};
      setBuffer(current=>current.some(member=>member.id===next.id)?current.map(member=>member.id===next.id?next:member):[...current,next]);setError("");closeEditor();setNativeOpen(false);setPreview(null);
    };
    const apply=()=>run(async()=>{const aliases=new Set();for(const member of selected){const alias=member.alias?.trim().toLocaleLowerCase();if(!alias)throw new Error("請先填寫已選成員的名稱。");if(aliases.has(alias))throw new Error(`「${member.alias}」在本次名單重名，請編輯其中一位的稱呼，方便準確 @。`);aliases.add(alias);}await onApply(clone(buffer));});
    const title=target?.kind?.startsWith("group")?"選擇群組成員":"調整本次參與者";
    const canContinue=target?.kind==="conversation-draft"||target?.kind==="conversation-members";
    const nativeLabel=canContinue?"從 DSH 會話匯入／接續":"從 DSH 會話匯入配置";
    const sessions=(sessionState?.ids??Object.keys(sessionState?.byId??{})).map(String).map(id=>({id,...sessionState?.byId?.[id]})).filter(session=>`${session.displayTitle??session.title??session.id} ${session.cwd??""}`.toLocaleLowerCase().includes(nativeQuery.trim().toLocaleLowerCase()));
    const inspectNative=(sessionId,continueSession=false)=>run(async()=>{if(continueSession&&!canContinue)throw new Error("原生會話只能接續到具體對話，不能保存為群組共用上下文。");const value=await api("/native-preview",{method:"POST",body:JSON.stringify({sessionId,target,continueSession})});if(alive.current)setPreview({...value,title:value.title??sessionState?.byId?.[sessionId]?.displayTitle??sessionState?.byId?.[sessionId]?.title??sessionId,sessionId,continueSession});});
    const importNative=()=>{if(!preview||busy)return;if(preview.continueSession&&(!preview.context||preview.busy))return;const alias=String(preview.title??sessionState?.byId?.[preview.sessionId]?.displayTitle??sessionState?.byId?.[preview.sessionId]?.title??"匯入的 Agent").slice(0,120);openEditor({alias,role:"",mandate:"",model:clone(preview.config?.model??{provider:"",model:""}),...(preview.continueSession?{context:clone(preview.context),lockedModel:true}:{}),nativeImport:{sessionId:preview.sessionId,title:alias}});};
    return h(Dialog,{title,onClose,onEscape:editing?closeEditor:nativeOpen?()=>setNativeOpen(false):onClose,busy,focusKey:editing?"editor":nativeOpen?"native":"picker"},
      editing?h(AgentEditor,{key:editing.id??"new",initial:editing,onSave:saveEdited,onCancel:closeEditor,submitLabel:target?.kind?.endsWith("draft")?"加入草稿":"加入待選",scope:target?.kind?.startsWith("group")?"本群組配置；不改 Agent 全局預設":"本次對話配置；不改群組預設"}):nativeOpen?h(React.Fragment,null,
        button("返回 Agent 選擇",()=>setNativeOpen(false),{disabled:busy}),h("h3",null,nativeLabel),h("p",{className:"dclAgentMeta"},"以下是原生聊天，不是 Agent 名冊。預設只匯入配置，不帶原聊天歷史、台帳或檔案授權。"),
        h("input",{className:"dclInput","aria-label":"搜尋 DSH 會話","data-dcl-initial-focus":true,value:nativeQuery,placeholder:"搜尋會話名稱或工作目錄…",onChange:event=>setNativeQuery(event.target.value)}),
        h("div",{className:"dclTeamCandidates"},sessions.map(session=>h("article",{className:"dclTeamCandidate",key:session.id},h("div",{className:"dclTeamCandidateInfo"},button(session.displayTitle??session.title??session.id,()=>inspectNative(session.id),{disabled:busy}),h("small",null,`${session.cwd??"未設定目錄"} · ${session.running?"執行中":"狀態待核驗"} · ${session.id.slice(0,8)}`)))),!sessions.length?h("p",{role:"status"},"沒有符合條件的 DSH 會話。"):null),
        preview?h("section",{className:"dclTeamNativePreview","aria-label":"原生會話接入預覽"},h("h3",null,preview.title??preview.sessionId),h("p",null,`模型：${modelText(preview.config?.model)}`),h("p",null,`原工作目錄：${preview.config?.cwd??"未設定"}`),h("p",null,preview.busy?"這段原生會話正在執行；不能接續，可以匯入配置使用新上下文。":"目前查得空閒；套用時仍須重新核驗。"),h("p",null,preview.sharedWith?.length?`已知共享位置：${preview.sharedWith.map(item=>item.name??item.id).join("、")}`:"未查到其他共享位置；不代表不存在外部引用。"),
          h("label",null,h("input",{type:"radio",name:"dcl-native-mode",checked:!preview.continueSession,disabled:busy,onChange:()=>void inspectNative(preview.sessionId,false)})," 匯入配置，使用新上下文"),
          canContinue?h("label",null,h("input",{type:"radio",name:"dcl-native-mode","aria-label":"接續原生會話",checked:preview.continueSession,disabled:busy||Boolean(preview.busy)||buffer.some(member=>member.context?.sessionId===preview.sessionId||member.sessionId===preview.sessionId),onChange:()=>void inspectNative(preview.sessionId,true)})," 接續原生會話：保留原歷史，共用模型與執行狀態"):h("p",{className:"dclAgentMeta"},"群組只保存配置；要接續原聊天，請在建立後的具體對話中選擇。"),
          preview.continueSession?h("p",{className:"dclNotice"},"此選擇會使用原會話的歷史與狀態，不是獨立副本。下一步確認稱呼後才加入待選；不立即派送。"):h("p",{className:"dclAgentMeta"},"不採用原工作目錄或權限；工作環境由目標群組／對話另行設定。"),
          button(preview.continueSession?"確認接續並設定稱呼":"匯入配置為新 Agent",importNative,{ref:nativeButton,className:"dclPrimary",disabled:busy||Boolean(preview.continueSession&&(preview.busy||!preview.context))})):null,
        error?h("p",{className:"dclError",role:"alert"},error):null):h(React.Fragment,null,
        h("div",{className:"dclTeamToolbar"},h("input",{className:"dclInput",value:query,"aria-label":"搜尋 Agent","data-dcl-initial-focus":true,placeholder:"搜尋名稱、職務…",onChange:event=>setQuery(event.target.value)}),button("新建 Agent",()=>openEditor(),{ref:newButton,disabled:busy})),
        groupMembers.length?h("div",{className:"dclTeamTabs",role:"group","aria-label":"候選來源"},button("所有 Agent",()=>setFilter("all"),{"aria-pressed":filter==="all"}),button("本群組",()=>setFilter("group"),{"aria-pressed":filter==="group"})):null,
        h("div",{className:"dclTeamCandidates",ref:listRef},loading?h("p",{role:"status"},"正在讀取 Agent 名冊…"):candidates.length?candidates.map(profile=>{
          const member=buffer.find(item=>match(item,profile)),checked=member&&member.enabled!==false,duplicate=names.get(String(profile.alias??"").trim().toLocaleLowerCase())>1,shortId=shortIdentity(profile),source=sourceHint(profile);
          return h("label",{className:`dclTeamCandidate${checked?" isSelected":""}`,key:profile.id,title:`${profile.alias}\nAgent ID：${profile.id}\n${source}`},h("input",{type:"checkbox",checked:Boolean(checked),disabled:busy||Boolean(profile.archivedAt&&!member&&!profile.fromGroup),"aria-label":`選擇 ${profile.alias} · ${profile.role||"未設定職務"} · ${shortId}${duplicate?` · ${source}`:""}`,onChange:()=>choose(profile)}),h("span",{className:"dclTeamAvatar","aria-hidden":true},(profile.alias??"A").slice(0,1)),h("span",{className:"dclTeamCandidateInfo"},h("strong",null,profile.alias),h("small",null,`${profile.role||"未設定職務"} · ${modelText(profile.model)}${profile.archivedAt?" · 名冊已收存":profile.fromDraft?" · 草稿配置":""}`),duplicate?h("small",null,`${source} · ${shortId}`):null));
        }):h("div",{className:"dclEmpty"},query?`找不到「${query}」`:"尚未建立 Agent。可在這裡直接新建，也可從 DSH 匯入配置。",query?button("清除搜尋",()=>setQuery("")):null)),
        h("section",{className:"dclTeamSelection","aria-label":"已選成員"},h("h3",null,`已選 ${selected.length} 位`),selected.map(member=>h("article",{className:"dclTeamSelected",key:member.id},h("div",null,h("strong",null,member.alias),h("small",null,`${member.role||"未設定職務"} · ${modelText(member.model)}${!member.agentId?" · 尚未發布":""}`),member.configurationError?h("small",{className:"dclError"},`原配置未能讀取：${member.configurationError}；可點編輯設定模型。`):null),h("div",null,button("編輯",()=>openEditor(member),{ref:element=>editButtons.current.set(member.id,element),disabled:busy,"aria-label":`編輯 ${member.alias}`}),button("本次不選",()=>setBuffer(current=>current.map(item=>item.id===member.id?{...item,enabled:false}:item)),{disabled:busy,"aria-label":`本次不選 ${member.alias}`}))))),
        h("p",{className:"dclAgentMeta"},target?.kind?.endsWith("draft")?"新 Agent 隨父草稿保存；建立群組或發送對話後才加入正式名冊。取消不改父草稿。":"這裡只準備選擇，確認後才套用到目前目標；不改其他群組或對話。"),
        button(nativeLabel,()=>{setNativeOpen(true);setError("");},{className:"dclMiniButton",disabled:busy}),
        buffer.length>=32?h("p",{className:"dclNotice"},"已達 32 份配置上限。",buffer.some(member=>member.enabled===false)?button("移除未選候選配置",()=>setBuffer(current=>current.filter(member=>member.enabled!==false)),{disabled:busy}):null," 此操作只移除選擇器內保留的候選配置，不刪除 Agent。"):null,
        error?h("div",{className:"dclError",role:"alert"},error,loadFailed?button("重新讀取名冊",()=>void load(),{disabled:busy}):h("p",null,"選擇保留在此面板。修正後可再次確認；取消則保持父項目原狀。")):null,
        extraContent??null,
        h("footer",{className:"dclTeamActions"},button("取消",onClose,{disabled:busy}),button(busy?"處理中…":`使用這 ${selected.length} 位`,apply,{className:"dclPrimary",disabled:busy}))));
  }

  function DirectoryField({value="",onChange,disabled=false,label="工作目錄"}) {
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[listing,setListing]=React.useState(null),[showHidden,setShowHidden]=React.useState(false),[manual,setManual]=React.useState(!ctx.uiWorkspace?.listDirectory);
    const [nativeWaiting,setNativeWaiting]=React.useState(false);
    const alive=React.useRef(true),request=React.useRef(0),lock=React.useRef(false),abort=React.useRef(null);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;abort.current?.abort();};},[]);
    const close=()=>{request.current++;abort.current?.abort();lock.current=false;setBusy(false);setNativeWaiting(false);setListing(null);};
    const browse=async(path,probe=false)=>{
      if(disabled||lock.current)return;lock.current=true;setBusy(true);setError("");const token=++request.current;
      if(typeof AbortController!=="undefined")abort.current=new AbortController();
      try{
        if(!ctx.uiWorkspace?.listDirectory)throw new Error("目前沒有可用的資料夾選擇能力，請貼上完整路徑。");
        let next;
        try{next=await ctx.uiWorkspace.listDirectory(path||undefined,abort.current?.signal);}
        catch(cause){
          if(probe&&cause?.rpcError?.code==="directory-picker/unavailable"&&cause.rpcError.details?.capability==="native"&&(ctx.remote?.directoryPicker?.pick||ctx.uiWorkspace.pickDirectory)){
            if(!alive.current||token!==request.current||abort.current?.signal.aborted)return;
            setNativeWaiting(true);let picked;
            if(ctx.remote?.directoryPicker?.pick){const result=await ctx.remote.directoryPicker.pick(abort.current?.signal);if(!result?.ok)throw new Error(result?.error?.message??"系統資料夾視窗未能完成選擇");picked=result.value;}
            else picked=await ctx.uiWorkspace.pickDirectory();
            if(picked!==null&&typeof picked!=="string")throw new Error("系統資料夾選擇回覆不是有效路徑");
            if(alive.current&&token===request.current&&picked!==null)onChange(picked);return;
          }
          throw cause;
        }
        if(alive.current&&token===request.current)setListing(next);
      }catch(cause){if(alive.current&&token===request.current){setError(`${message(cause)} 原路徑未變更。`);setManual(true);}}
      finally{if(token===request.current){lock.current=false;if(alive.current){setBusy(false);setNativeWaiting(false);}}}
    };
    return h("div",{className:"dclTeamDirectory"},h("div",{className:"dclTeamDirectorySummary"},h("div",null,h("strong",null,label),h("p",{className:"dclTeamPath"},value||"尚未選擇；可先保存配置")),button(nativeWaiting?"等待系統視窗…":busy?"讀取中…":"選擇資料夾",()=>browse(value,true),{disabled:disabled||busy||!ctx.uiWorkspace?.listDirectory})),
      nativeWaiting?h("div",{className:"dclNotice"},h("p",{role:"status"},"等待系統資料夾視窗。視窗可能位於其他視窗後方；也可取消選擇，改用手動貼上路徑。"),!ctx.remote?.directoryPicker?.pick?h("p",{className:"dclAgentMeta"},"此舊版連線無法直接關閉系統視窗；取消後會忽略其結果，必要時請在系統視窗按取消。"):null,button("取消選擇",()=>{close();setManual(true);})):null,
      h("details",{open:manual,onToggle:event=>setManual(event.currentTarget.open)},h("summary",null,"手動貼上完整路徑"),h("input",{className:"dclInput","aria-label":label,value,disabled:disabled||busy,placeholder:"例如：/Users/你的名稱/Documents",onChange:event=>onChange(event.target.value)})),
      !ctx.uiWorkspace?.listDirectory?h("p",{className:"dclAgentMeta"},"DSH 目錄選擇器尚未可用；可手動貼上完整路徑。"):null,
      h("p",{className:"dclAgentMeta"},"選擇位置不會授予額外檔案或寫入權限。"),
      error?h("p",{className:"dclError",role:"alert"},error):null,
      listing?h(Dialog,{title:"選擇資料夾",onClose:close,busy:false,focusKey:"directory"},
        h("nav",{className:"dclTeamBreadcrumbs","aria-label":"目錄路徑"},(listing.crumbs??[]).map(crumb=>button(crumb.name,()=>browse(crumb.path),{key:crumb.path,disabled:busy,"aria-current":crumb.path===listing.path?"location":undefined}))),
        h("p",{className:"dclTeamPath"},listing.path),h("label",null,h("input",{type:"checkbox",checked:showHidden,onChange:event=>setShowHidden(event.target.checked)})," 顯示隱藏資料夾"),
        h("div",{className:"dclTeamCandidates"},busy?h("p",{role:"status"},"讀取資料夾中…"):null,(listing.entries??[]).filter(entry=>showHidden||!entry.hidden).map(entry=>button(entry.name,()=>browse(entry.path),{key:entry.path,className:"dclTeamFolder",disabled:busy})),!(listing.entries??[]).some(entry=>showHidden||!entry.hidden)?h("p",null,"沒有可顯示的子資料夾；仍可選擇目前位置。"):null),
        listing.truncated?h("p",{className:"dclNotice"},"此目錄只顯示部分子資料夾。找不到時可返回並貼上完整路徑。"):null,
        error?h("p",{className:"dclError",role:"alert"},error):null,
        h("footer",{className:"dclTeamActions"},button("取消",close),button("使用此資料夾",()=>{onChange(listing.path);close();},{className:"dclPrimary",disabled:busy||disabled}))):null);
  }

  function AgentLibrary({onClose,onChanged}={}) {
    const [profiles,setProfiles]=React.useState([]),[loading,setLoading]=React.useState(true),[query,setQuery]=React.useState(""),[archived,setArchived]=React.useState(false),[editing,setEditing]=React.useState(null),[pending,setPending]=React.useState(null),[error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[busy,setBusy]=React.useState(false);
    const pendingKey="dcl:agent-library-pending-save:v1";
    const [pendingSave,setPendingSave]=React.useState(()=>{try{const value=JSON.parse(localStorage.getItem(pendingKey)??"null");return value?.key&&value?.body?.operationId&&typeof value.body.profile?.alias==="string"?value:null;}catch{return null;}});
    const lock=React.useRef(false),alive=React.useRef(true),receipt=React.useRef(null),saveReceipt=React.useRef(pendingSave);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const load=async()=>{setLoading(true);setError("");try{const result=await api("/agents?archived=true");if(alive.current)setProfiles(Array.isArray(result)?result:result.agents??result.profiles??[]);}catch(cause){if(alive.current)setError(`名冊讀取失敗：${message(cause)}`);}finally{if(alive.current)setLoading(false);}};
    React.useEffect(()=>{void load();},[]);
    const usageList=profile=>Array.isArray(profile.usages)?profile.usages:[...(profile.usages?.groups??[]),...(profile.usages?.conversations??[])];
    const operation=payload=>{const key=JSON.stringify(payload);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};return receipt.current.id;};
    const cacheSave=intent=>{try{if(typeof localStorage!=="undefined"){if(intent)localStorage.setItem(pendingKey,JSON.stringify(intent));else localStorage.removeItem(pendingKey);}}catch{setNotice("本機回執暫存不可用；保存未確認前請保留此頁，不要重新建立 Agent。");}};
    const accept=async(value,summary)=>{const profile=value.profile??value.agent??value;if(!profile?.id)throw new Error("保存回覆缺少 Agent 身分，請重試核對同一操作；未重建 Agent。");if(!alive.current)return;setProfiles(current=>[...current.filter(item=>item.id!==profile.id),{...current.find(item=>item.id===profile.id),...profile,configured:Boolean(profile.model?.provider&&profile.model?.model)}]);setNotice(summary);setEditing(null);setPending(null);try{await onChanged?.(profile);}catch{setNotice(`${summary}；其他列表尚待刷新。`);}};
    const save=async profile=>{
      if(lock.current)return;
      const payload={...(editing?.id?{id:editing.id,expectedRevision:editing.revision}:{}),profile:{alias:profile.alias,role:profile.role??"",mandate:profile.mandate??"",model:clone(profile.model??{provider:"",model:""})}};
      const key=JSON.stringify(payload);
      if(saveReceipt.current&&saveReceipt.current.key!==key)throw new Error("上次保存結果未確認；請先核對上次保存結果。後續修改保留在編輯器中，不會另建 Agent。");
      lock.current=true;setBusy(true);setError("");
      const intent=saveReceipt.current??{key,body:{...payload,operationId:crypto.randomUUID()}};saveReceipt.current=intent;setPendingSave(intent);cacheSave(intent);
      try{const result=await api("/agents",{method:"POST",body:JSON.stringify(intent.body)});await accept(result,"Agent 已保存；現有群組與對話的配置不變，沒有建立原生會話。");saveReceipt.current=null;setPendingSave(null);cacheSave(null);}
      catch(cause){if(cause?.status===400||cause?.status===409){saveReceipt.current=null;setPendingSave(null);cacheSave(null);}else setPendingSave(intent);throw cause;}
      finally{lock.current=false;if(alive.current)setBusy(false);}
    };
    const reconcileSave=async()=>{
      if(lock.current||!saveReceipt.current)return;lock.current=true;setBusy(true);setError("");const intent=saveReceipt.current;
      try{const result=await api("/agents",{method:"POST",body:JSON.stringify(intent.body)}),profile=result.profile??result.agent??result;if(!profile?.id)throw new Error("回覆仍缺少 Agent 身分");cacheSave(null);saveReceipt.current=null;if(!alive.current)return;setProfiles(current=>[...current.filter(item=>item.id!==profile.id),profile]);setEditing(current=>current?{...current,id:profile.id,revision:profile.revision}:null);setPendingSave(null);setNotice("上次保存已確認；編輯器中的後續修改仍未保存。");try{await onChanged?.(profile);}catch{}}
      catch(cause){if(alive.current)setError(`尚未確認上次保存：${message(cause)}。輸入保留，不會以新憑據重建。`);}
      finally{lock.current=false;if(alive.current)setBusy(false);}
    };
    const lifecycle=async()=>{
      if(lock.current||!pending)return;lock.current=true;setBusy(true);setError("");const payload={action:pending.archivedAt?"restore":"archive",expectedRevision:pending.revision};
      try{const result=await api(`/agents/${encodeURIComponent(pending.id)}/lifecycle`,{method:"POST",body:JSON.stringify({...payload,operationId:operation({id:pending.id,...payload})})});await accept(result,payload.action==="archive"?"Agent 已從常規名冊歸檔；現有群組與對話、預選名單及任務不變。":"Agent 已恢復到名冊；沒有重新啟動舊任務。");}
      catch(cause){if(alive.current)setError(`${message(cause)}。原確認內容保留，可重試核對。`);}
      finally{lock.current=false;if(alive.current)setBusy(false);}
    };
    const visible=profiles.filter(profile=>(archived||!profile.archivedAt)&&`${profile.alias??""} ${profile.role??""} ${profile.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return h("section",{className:"dclTeamLibrary","aria-label":"Agent 名冊"},
      h("header",{className:"dclTeamHeader"},h("div",null,h("h2",null,"Agent"),h("p",{className:"dclAgentMeta"},"可重用的助手身分與配置；不是原生會話或聊天歷史。")),onClose?button("返回群組",onClose,{disabled:busy}):null),
      h("div",{className:"dclTeamToolbar"},h("input",{className:"dclInput","aria-label":"搜尋 Agent 名冊",value:query,placeholder:"搜尋名稱、職務…",onChange:event=>setQuery(event.target.value)}),button("新建 Agent",()=>{setEditing({});setError("");},{className:"dclPrimary",disabled:busy||Boolean(pendingSave)})),
      h("label",null,h("input",{type:"checkbox","aria-label":"顯示已歸檔 Agent",checked:archived,onChange:event=>setArchived(event.target.checked)})," 顯示已歸檔"),
      loading?h("p",{role:"status"},"正在讀取 Agent 名冊…"):visible.length?h("div",{className:"dclTeamLibraryList"},visible.map(profile=>h("article",{className:"dclTeamLibraryCard",key:profile.id},h("span",{className:"dclTeamAvatar","aria-hidden":true},(profile.alias??"A").slice(0,1)),h("div",{className:"dclTeamCandidateInfo"},h("strong",null,profile.alias),h("small",null,`${profile.role||"未設定職務"} · ${modelText(profile.model)}`),h("small",null,`${profile.id.slice(0,8)} · 版本 ${profile.revision}${profile.archivedAt?" · 已歸檔":""}${profile.configured===false?" · 開始前待設定":""}`),usageList(profile).length?h("small",null,`使用位置：${usageList(profile).map(item=>item.name??item.title??item.id).join("、")}`):null),h("div",{className:"dclTeamMemberActions"},button("編輯",()=>{if(saveReceipt.current)return;setEditing(clone(profile));setError("");},{disabled:busy||Boolean(pendingSave),"aria-label":`編輯 ${profile.alias}`}),button(profile.archivedAt?"恢復":"歸檔",()=>{if(saveReceipt.current)return;setPending(profile);setError("");},{disabled:busy||Boolean(pendingSave),"aria-label":`${profile.archivedAt?"恢復":"歸檔"} ${profile.alias}`}))))):h("div",{className:"dclEmpty"},query?`沒有符合「${query}」的 Agent。`:"尚無 Agent；可在這裡新建，或在組隊時原地建立。"),
      notice?h("p",{className:"dclNotice",role:"status"},notice):null,
      pendingSave&&!editing?h("div",{className:"dclNotice"},"有一筆 Agent 保存結果未確認；關閉編輯器並未撤銷已送出的保存。",button("核對上次保存結果",reconcileSave,{disabled:busy})):null,
      error&&!editing&&!pending?h("div",{className:"dclError",role:"alert"},error,button("重試讀取名冊",()=>void load(),{disabled:busy})):null,
      editing?h(Dialog,{title:editing.id?"編輯 Agent 預設":"新建 Agent",busy,onClose:()=>setEditing(null),focusKey:"agent-editor"},h("div",null,pendingSave?h("div",{className:"dclNotice"},"上次保存結果未確認；改名或改模型前先核對，可避免建立重複 Agent。",button("核對上次保存結果",reconcileSave,{disabled:busy})):null,error?h("p",{className:"dclError",role:"alert"},error):null,notice?h("p",{className:"dclAgentMeta",role:"status"},notice):null,h(AgentEditor,{key:"library-editor",initial:editing,onSave:save,onCancel:()=>setEditing(null),submitLabel:"保存 Agent",scope:"Agent 名冊的未來配置；不自動修改已存在群組或對話"}))):null,
      pending?h(Dialog,{title:pending.archivedAt?"恢復 Agent":"歸檔 Agent",busy,onClose:()=>setPending(null),focusKey:"agent-lifecycle"},h("p",null,pending.archivedAt?`恢復「${pending.alias}」到可選名冊？不會重新開始任務。`:`將「${pending.alias}」從常規候選名冊收存？`),h("p",null,`現有群組與對話仍可使用原有配置；不停止任務、不移除群組成員或預選、不刪原生會話或檔案。${usageList(pending).length?` 已知使用位置：${usageList(pending).map(item=>item.name??item.title??item.id).join("、")}。`:""}`),error?h("p",{className:"dclError",role:"alert"},error):null,h("footer",{className:"dclTeamActions"},button("取消",()=>setPending(null),{disabled:busy}),button(busy?"保存中…":pending.archivedAt?"確認恢復":"確認歸檔",lifecycle,{className:"dclPrimary",disabled:busy}))):null);
  }

  return {Dialog,AgentEditor,ParticipantPicker,DirectoryField,AgentLibrary};
}
