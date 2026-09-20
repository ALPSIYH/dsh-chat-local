window.__ModuleLoader__.load({
  id: "dsh-chat-local",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const h = React.createElement;
    const name = "dsh-chat-local";
    const inject = ["slots", "sessions", "modelDirectories", "remote", "remote.session", "uiWorkspace", "remote.directoryPicker"];
    const BASE = "/api/dsh-chat-local";
    const HUMAN_ID = "human:me";
    // BEGIN GENERATED TEXT PROTOCOL
    const textProtocol = (function createTextProtocol() {
  const extensions = "docx|md|markdown|mdx|txt|json|jsonl|yaml|yml|toml|csv|tsv|js|jsx|mjs|cjs|ts|tsx|py|r|do|rb|rs|go|java|kt|swift|sh|zsh|fish|sql|html|css|scss|xml|tex|bib|log";
  function fileReferences(text) {
    const found = new Set();
    let rest = String(text ?? "");
    const add = value => { const path=value.trim(); if(path && !/^[a-z][a-z\d+.-]*:/iu.test(path)) found.add(path); };
    for (const pattern of ["\\]\\(<([^>\\n]+?\\.(?:"+extensions+"))>\\)", "`([^`\\n]+?\\.(?:"+extensions+"))`", "\\]\\(([^)\\n]+?\\.(?:"+extensions+"))\\)"]) {
      rest=rest.replace(new RegExp(pattern,"giu"),(_match,path)=>{add(path);return " ";});
    }
    rest=rest.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>`]+/giu," ");
    // Natural language frequently contains macOS paths with spaces and no Markdown wrapper.
    rest=rest.replace(new RegExp("/(?:Users|Volumes|private|tmp|home|mnt|workspace)/[^\\n<>`，。；;]*?\\.(?:"+extensions+")(?=$|[\\s，。；;）)\\]])","giu"),(path)=>{add(path);return " ";});
    for (const match of rest.matchAll(new RegExp("(?:^|[\\s（(：:])(/(?!/)[^\\s<>`，。；;]+?\\.(?:"+extensions+"))(?=$|[\\s，。；;）)\\]])","giu"))) add(match[1]);
    return [...found];
  }
  function mentions(text, members) {
    const visible=String(text??"").replace(/```[^]*?(?:```|$)|~~~[^]*?(?:~~~|$)|`[^`\n]*`|https?:\/\/\S+/gu," ");
    const ordered=[...members].filter(m=>m.alias).sort((a,b)=>b.alias.length-a.alias.length);
    const result=new Set();
    for(let index=visible.indexOf("@");index>=0;index=visible.indexOf("@",index+1)) {
      if(index>0 && /[a-z\d_]/iu.test(visible[index-1])) continue;
      const tail=visible.slice(index+1);
      const all=tail.match(/^(all|全部)(?![a-z\d_-])/iu);
      if(all){result.add("all");continue;}
      for(const member of ordered) {
        if(tail.slice(0,member.alias.length).toLocaleLowerCase()!==member.alias.toLocaleLowerCase())continue;
        const next=tail[member.alias.length]??"";
        if(/^[\x00-\x7F]+$/u.test(member.alias)&&/[\p{L}\p{N}_-]/u.test(next))continue;
        result.add(`session:${encodeURIComponent(member.sessionId)}`);break;
      }
    }
    return [...result];
  }
  return { fileReferences, mentions };
})();
    // END GENERATED TEXT PROTOCOL

    function ensureStyles() {
      if (typeof document === "undefined") return;
      const style = document.querySelector('style[data-plugin-css="dsh-chat-local"]') ?? document.createElement("style");
      style.dataset.plugin = "dsh-chat-local";
      style.dataset.pluginCss = "dsh-chat-local";
      style.textContent = `
        .dclFooterBtn { display:flex; align-items:center; gap:7px; width:100%; min-width:0; overflow:hidden; white-space:nowrap; border:0; background:transparent; color:inherit; padding:6px 8px; border-radius:8px; font:inherit; font-size:12px; cursor:pointer; }
        .dclFooterBtn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); }
        .dclFooterBtnOn { background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08)); font-weight:600; }
        .dclFooterIcon { width:16px; height:16px; flex:0 0 16px; display:block; }
        .dclFooterLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; }
        .dclSrOnly { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important; }
        /* DSH 0.1.5: the workbench mounts in the shell.overlay layer, which already
           covers the whole frame; no body-class grid surgery on the AppFrame anymore. */
        .dclWorkspace { position:absolute; inset:0; z-index:1; height:100%; min-height:0; display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#1a1a1a); }
        .dclWorkspaceBar { display:flex; align-items:center; justify-content:flex-start; gap:10px; padding:10px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); background:var(--dsw-alias-bg-layer-1,#fff); flex:0 0 auto; }
        .dclWorkspaceTitle { font-size:14px; font-weight:680; }
        .dclClose { border:0; background:transparent; color:inherit; font-size:18px; cursor:pointer; padding:2px 8px; border-radius:6px; }
        .dclClose:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08)); }
        .dclDecisionChoices { padding:0; border:0; margin:16px 0; min-width:0; display:grid; gap:8px; }
        .dclDecisionOption { display:flex; gap:10px; align-items:flex-start; padding:12px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14)); border-radius:10px; cursor:pointer; }
        .dclDecisionOption.selected { border-color:var(--dsw-alias-color-primary,#5870d8); background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.04)); }
        .dclDecisionOption input { margin-top:4px; flex-shrink:0; }
        .dclDecisionOption>span { min-width:0; overflow-wrap:anywhere; }
        .dclDecisionImpact { display:block; color:var(--dsw-alias-label-secondary,#666); font-size:12px; line-height:1.6; margin-top:5px; white-space:pre-wrap; }
        .dclActionLink { display:block; width:100%; text-align:left; padding:9px 0; border:0; background:none; color:var(--dsw-alias-color-primary,#5870d8); font:inherit; cursor:pointer; overflow-wrap:anywhere; }
        .dclBody { position:relative; container-type:inline-size; flex:1; min-height:0; display:flex; font-size:13px; line-height:1.55; color:var(--dsw-alias-label-primary,#1a1a1a); background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclSide { width:190px; flex:0 0 auto; border-right:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); padding:14px 10px; box-sizing:border-box; overflow-y:auto; background:var(--dsw-alias-bg-base,#fafafa); }
        .dclBody.dclRoomSideClosed .dclSide { display:none; }
        .dclSideHead { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 4px 12px; }
        .dclMain { position:relative; flex:1; min-width:0; display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclTitle { font-size:15px; font-weight:680; margin:0; letter-spacing:-.01em; }
        .dclInput,.dclSelect { width:100%; box-sizing:border-box; height:34px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14)); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; padding:0 10px; font:inherit; font-size:12px; }
        .dclNewRoom { width:100%; height:36px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.11)); border-radius:9px; background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
        .dclNewRoom:hover { border-color:var(--dsw-alias-border-l1,rgba(0,0,0,.2)); background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.03)); }
        .dclRoomSection { margin:14px 6px 6px; color:var(--dsw-alias-label-tertiary,#888); font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
        .dclRowButton { position:relative; width:100%; text-align:left; border:0; background:transparent; color:inherit; border-radius:9px; padding:9px 10px 9px 14px; font:inherit; cursor:pointer; }
        .dclRowButton:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); }
        .dclRowActive { background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.07)); }
        .dclRowActive::before { content:""; position:absolute; left:5px; top:12px; width:4px; height:4px; border-radius:50%; background:var(--dsw-alias-color-primary,#5870d8); }
        .dclRoomName { font-size:12px; font-weight:620; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclRoomMeta { display:flex; align-items:center; gap:5px; margin-top:2px; color:var(--dsw-alias-label-tertiary,#888); font-size:10px; font-weight:400; }
        .dclRoomRunning { color:var(--dsw-alias-state-success-primary,#208a55); }
        .dclEmpty { color:var(--dsw-alias-label-tertiary,#888); text-align:center; padding:28px 12px; }
        .dclHeader { min-height:58px; box-sizing:border-box; padding:9px 16px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); display:flex; align-items:center; gap:10px; flex:0 0 auto; background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclHeaderIntro { flex:0 1 auto; min-width:130px; max-width:260px; }
        .dclHeaderName { font-size:15px; font-weight:680; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:-.01em; }
        .dclHeaderMode { color:var(--dsw-alias-label-tertiary,#888); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclHeaderSpacer { flex:1; min-width:8px; }
        .dclMembers { display:flex; gap:6px; align-items:center; flex:0 1 auto; min-width:0; }
        .dclAvatarStack { display:flex; align-items:center; padding-left:8px; }
        .dclAvatarStack .dclAgentAvatar { margin-left:-8px; border:2px solid var(--dsw-alias-bg-layer-1,#fff); }
        .dclPeopleCount { font-size:11px; color:var(--dsw-alias-label-secondary,#666); white-space:nowrap; }
        .dclIconButton { width:32px; height:32px; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; border:1px solid transparent; border-radius:8px; background:transparent; color:inherit; font:inherit; font-size:16px; cursor:pointer; }
        .dclIconButton:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.06)); }
        .dclBackButton { width:auto; padding:0 7px; gap:5px; font-size:11px; font-weight:600; }
        .dclBackLabel { white-space:nowrap; }
        .dclHeaderIcon { width:16px; height:16px; display:block; }
        .dclNavControls { display:flex; align-items:center; gap:3px; flex:0 0 auto; }
        .dclTimeline { flex:1; overflow-y:auto; padding:18px 22px 10px; min-height:0; scroll-padding-bottom:18px; }
        .dclThread { width:min(760px,100%); margin:0 auto; }
        .dclTimelineWrap { position:relative; flex:1; min-height:0; display:flex; }
        .dclNewMessages { position:absolute; left:50%; bottom:12px; transform:translateX(-50%); z-index:3; border:0; border-radius:16px; background:var(--dsw-alias-label-primary,#222); color:var(--dsw-alias-bg-base,#fff); padding:5px 12px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.18); }
        .dclMsg { position:relative; display:grid; grid-template-columns:30px minmax(0,1fr); column-gap:9px; margin:0 0 16px; max-width:100%; }
        .dclMsg.human { display:flex; flex-direction:column; align-items:flex-end; margin-left:auto; max-width:min(78%,620px); }
        .dclMsg.causal::before { content:""; position:absolute; left:14px; top:-14px; width:1px; height:13px; background:var(--dsw-alias-border-l1,rgba(0,0,0,.18)); }
        .dclMsgAvatar { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--dcl-agent-accent,var(--dsw-alias-color-primary,#5870d8)); color:#fff; font-size:11px; font-weight:700; box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,#fff); }
        .dclMsgBody { min-width:0; }
        .dclMsgText { display:inline-block; max-width:100%; box-sizing:border-box; white-space:pre-wrap; overflow-wrap:anywhere; border-radius:10px; padding:7px 10px; background:var(--dsw-alias-bg-base,#fafafa); border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.07)); color:var(--dsw-alias-label-primary,#1a1a1a); }
        .dclMsg:not(.human) .dclMsgText:hover { border-color:var(--dsw-alias-border-l1,rgba(0,0,0,.13)); }
        .dclMsg.human .dclMsgText { text-align:left; background:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 12%,var(--dsw-alias-bg-layer-1,#fff)); color:var(--dsw-alias-label-primary,#1a1a1a); border-color:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 22%,transparent); }
        .dclMsgMeta { display:flex; align-items:center; gap:5px; min-height:18px; font-size:10px; color:var(--dsw-alias-label-tertiary,#888); margin:0 2px 3px; }
        .dclMsg.human .dclMsgMeta { justify-content:flex-end; }
        .dclMsgAuthor { color:var(--dsw-alias-label-primary,#1a1a1a); font-size:11px; font-weight:650; }
        .dclStatusDot { width:5px; height:5px; border-radius:50%; background:var(--dsw-alias-label-tertiary,#aaa); }
        .dclStatusDot.live { background:var(--dsw-alias-state-success-primary,#35a26b); }
        .dclReplyMeta { color:var(--dcl-agent-accent,var(--dsw-alias-color-primary,#5870d8)); }
        .dclMsgMentions { display:flex; gap:4px; flex-wrap:wrap; margin:5px 2px 0; }
        .dclMsgMention { font-size:10px; color:var(--dsw-alias-color-primary,#5870d8); background:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 10%,transparent); border-radius:9px; padding:1px 6px; }
        .dclArtifactRefs { display:flex; gap:5px; flex-wrap:wrap; margin:6px 2px 0; }
        .dclArtifactRef { display:flex; align-items:center; gap:5px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.11)); background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-color-primary,#5870d8); border-radius:8px; padding:4px 8px; font:inherit; font-size:10px; cursor:pointer; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclArtifactRef:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.035)); }
        .dclDelivery { display:flex; gap:5px; flex-wrap:wrap; margin:4px 2px 0; justify-content:flex-end; }
        .dclDeliveryItem { font-size:10px; color:var(--dsw-alias-label-tertiary,#888); }
        .dclDeliveryItem.failed { color:var(--dsw-alias-state-error-primary,#b42318); }
        .dclMsgActions { display:flex; align-items:center; gap:3px; margin:5px 2px 0; opacity:.38; transition:opacity .14s ease; }
        .dclMsg:hover .dclMsgActions,.dclMsg:focus-within .dclMsgActions { opacity:1; }
        .dclMsgAction { min-height:24px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary,#666); cursor:pointer; font:inherit; font-size:10px; padding:0 6px; }
        .dclMsgAction:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); color:var(--dsw-alias-label-primary,#222); }
        .dclMsgAction.failed { color:var(--dsw-alias-state-error-primary,#b42318); }
        .dclMsg.system .dclMsgText { background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#a26708) 8%,var(--dsw-alias-bg-layer-1,#fff)); border-style:dashed; }
        .dclMsg.system .dclMsgAvatar { background:var(--dsw-alias-state-warning-primary,#9a650b); }
        .dclComposerWrap { padding:8px 18px 14px; background:var(--dsw-alias-bg-layer-1,#fff); flex:0 0 auto; }
        .dclComposer { width:min(760px,100%); margin:0 auto; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15)); border-radius:14px; background:var(--dsw-alias-bg-layer-1,#fff); padding:8px 9px 9px; box-shadow:0 4px 18px rgba(0,0,0,.045); transition:border-color .16s ease,box-shadow .16s ease; }
        .dclComposer:focus-within { border-color:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 55%,transparent); box-shadow:0 5px 20px rgba(0,0,0,.065),0 0 0 2px color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 8%,transparent); }
        .dclAudience { flex:1; min-width:130px; font-size:10px; color:var(--dsw-alias-label-tertiary,#888); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclMentionBar { display:flex; gap:5px; flex-wrap:nowrap; overflow-x:auto; padding:0 1px 5px; scrollbar-width:thin; }
        .dclMention { min-height:28px; box-sizing:border-box; display:inline-flex; align-items:center; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); background:var(--dsw-alias-bg-base,#f7f7f8); color:var(--dsw-alias-label-secondary,#555); border-radius:10px; padding:2px 8px; font:inherit; font-size:10px; cursor:pointer; white-space:nowrap; }
        .dclMention:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); }
        .dclMention:disabled { opacity:.55; cursor:default; }
        .dclMentionOn { background:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 11%,var(--dsw-alias-bg-layer-1,#fff)); border-color:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 35%,transparent); color:var(--dsw-alias-color-primary,#5870d8); font-weight:650; }
        .dclComposerRow { display:flex; align-items:flex-end; gap:8px; }
        .dclTextarea { flex:1; min-height:42px; max-height:150px; resize:none; box-sizing:border-box; border:0; border-radius:8px; background:transparent; color:inherit; padding:7px 8px; font:inherit; line-height:1.5; outline:none; }
        .dclComposerFoot { display:flex; align-items:center; gap:8px; padding:3px 1px 0 7px; }
        .dclKeyHint { color:var(--dsw-alias-label-tertiary,#999); font-size:9px; white-space:nowrap; }
        .dclSend,.dclPrimary { border:0; border-radius:9px; background:var(--dsw-alias-color-primary,#5870d8); color:#fff; height:32px; padding:0 15px; cursor:pointer; font:inherit; font-size:11px; font-weight:650; white-space:nowrap; }
        .dclSend:disabled,.dclPrimary:disabled { opacity:.5; cursor:default; }
        .dclDanger { border:0; border-radius:9px; background:var(--dsw-alias-state-error-primary,#a32920); color:#fff; height:34px; padding:0 12px; cursor:pointer; font:inherit; font-size:11px; font-weight:650; }
        .dclSecondary { border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14)); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; height:34px; padding:0 10px; cursor:pointer; font:inherit; white-space:nowrap; }
        .dclError { color:var(--dsw-alias-state-error-primary,#b42318); font-size:11px; padding:6px 14px; background:rgba(180,35,24,.06); }
        .dclNotice { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--dsw-alias-label-secondary,#666); font-size:11px; padding:6px 14px 0; }
        .dclNoticeDismiss { border:0; background:transparent; color:inherit; cursor:pointer; font:inherit; font-size:15px; line-height:1; }
        .dclAgentPanel { border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); padding:10px 14px; background:var(--dsw-alias-bg-layer-1,#fff); flex:0 0 auto; max-height:min(40vh,340px); overflow-y:auto; box-shadow:0 -8px 24px rgba(0,0,0,.04); }
        .dclInspector { position:absolute; right:0; top:0; bottom:0; width:min(380px,92%); z-index:15; border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); background:var(--dsw-alias-bg-layer-1,#fff); display:flex; flex-direction:column; min-height:0; box-shadow:-12px 0 30px rgba(0,0,0,.11); }
        .dclInspectorHead { padding:10px 12px; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .dclInspectorBody { padding:10px 12px; overflow:auto; min-height:0; }
        .dclPreviewMeta { font-size:10px; color:var(--dsw-alias-label-tertiary,#888); overflow-wrap:anywhere; margin-bottom:8px; }
        .dclPreviewMeta summary { cursor:pointer; font-weight:600; color:var(--dsw-alias-label-secondary,#666); margin-bottom:5px; }
        .dclFileChoices h3 { margin:4px 0 8px; font-size:14px; }
        .dclFileChoices p { font-size:12px; line-height:1.65; color:var(--dsw-alias-label-secondary,#666); overflow-wrap:anywhere; }
        .dclFileChoices .dclFileChoice { display:flex; flex-direction:column; gap:8px; margin:8px 0; padding:12px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); }
        .dclFileChoicePath { font-size:12px; line-height:1.6; overflow-wrap:anywhere; white-space:normal; }
        .dclFileChoice:focus-visible { outline:2px solid var(--dsw-alias-color-primary,#5870d8); outline-offset:2px; }
        .dclPreview { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
        .dclDocxFileName { font-weight:600; font-size:13px; line-height:1.55; overflow-wrap:anywhere; margin:10px 0; }
        .dclDocxToolbar { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin:10px 0; }
        .dclDocxToolbar .dclSelect { flex:1 1 120px; min-width:0; max-width:100%; }
        .dclDocxToolbar button[aria-pressed="true"] { color:var(--dsw-alias-color-primary,#5870d8); border-color:currentColor; background:var(--dcl-tint); }
        .dclDocxHint,.dclDocxLimits { font-size:12px; line-height:1.65; color:var(--dcl-muted); margin:8px 0; }
        .dclDocxLimits summary { cursor:pointer; }
        .dclDocxSearch { display:flex; gap:6px; margin:10px 0; }
        .dclDocxSearch input { flex:1; min-width:0; }
        .dclDocxToggle { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dcl-muted); margin:12px 0; }
        .dclDocxPage { max-width:780px; margin:20px auto 0; border-top:1px solid var(--dcl-line); padding:24px 6px; font-family:Georgia,"Noto Serif SC","Songti SC",serif; line-height:1.85; overflow-wrap:break-word; color:var(--dcl-text); }
        .dclDocxPage p { margin:0 0 1.15em; white-space:pre-wrap; }
        .dclDocxPage h2,.dclDocxPage h3,.dclDocxPage h4,.dclDocxPage h5,.dclDocxPage h6 { font-family:inherit; font-size:1.17em; line-height:1.5; margin:1.4em 0 .75em; font-weight:700; }
        .dclDocxPage .dclDocxTitle { font-size:1.45em; margin:0 0 1em; line-height:1.4; }
        .dclDocxPage mark { background:#f6cf6380; color:inherit; border-radius:2px; }
        .dclDocxBlock { scroll-margin:20px; }
        .dclDocxBlock.isActive { outline:2px solid var(--dsw-alias-color-primary,#5870d8); outline-offset:5px; border-radius:2px; }
        .dclDocxLocator { float:right; margin:0 0 4px 8px; padding:2px 5px; border:1px solid var(--dcl-line); border-radius:4px; background:var(--dcl-tint); color:var(--dcl-muted); font:11px/1.5 ui-monospace,monospace; cursor:pointer; }
        .dclDocxNoteRef { border:0; background:transparent; color:var(--dsw-alias-color-primary,#5870d8); padding:0 2px; font:inherit; cursor:pointer; text-decoration:underline; }
        .dclDocxNoteLabel { display:block; font:600 12px/1.6 system-ui,sans-serif; color:var(--dcl-muted); margin:12px 0 4px; }
        .dclDocxPlaceholder { display:inline-block; border:1px dashed var(--dcl-line); padding:6px 9px; margin:6px 0; font:12px/1.6 system-ui,sans-serif; color:var(--dcl-muted); }
        .dclDocxTable { overflow:auto; max-width:100%; margin:18px 0; }
        .dclDocxTable table { border-collapse:collapse; min-width:100%; font-size:.9em; }
        .dclDocxTable td,.dclDocxTable th { min-width:90px; padding:9px; border:1px solid var(--dcl-line); vertical-align:top; text-align:left; }
        .dclDocxTable th { background:var(--dcl-tint); }
        .dclDocxTable p { margin:0 0 .4em; }
        .dclDocxCitation { display:grid; gap:8px; border:1px solid var(--dcl-line); border-radius:8px; background:var(--dcl-tint); padding:12px; margin:14px 0; font-size:12px; }
        .dclDocxCitation code { overflow-wrap:anywhere; }
        .dclDocxCitation p { margin:0; line-height:1.6; }
        .dclBody .dclInspector.dclInspectorExpanded { position:absolute; inset:0; width:100%; z-index:16; box-shadow:none; }
        .dclInspectorExpanded .dclInspectorBody { padding:18px clamp(18px,6%,80px); }
        .dclPolicy { display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:9px; background:var(--dsw-alias-bg-layer-2,#f5f5f6); }
        .dclPolicyLabel { font-size:10px; color:var(--dsw-alias-label-secondary,#666); }
        .dclPolicySelect { border:0; background:transparent; color:inherit; font:inherit; font-size:11px; font-weight:600; outline:none; }
        .dclAgentPanelHead { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
        .dclAgentTools { display:flex; align-items:center; gap:6px; padding:8px; margin-bottom:8px; border-radius:10px; background:var(--dsw-alias-bg-layer-2,#f5f5f6); }
        .dclAgentRow { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; }
        .dclAgentRow:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04)); }
        .dclAgentAvatar { width:24px; height:24px; border-radius:50%; background:var(--dcl-agent-accent,var(--dsw-alias-color-primary,#5870d8)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; flex:0 0 auto; }
        .dclAgentInfo { flex:1; min-width:0; }
        .dclAgentName { font-weight:600; font-size:12px; }
        .dclAgentMeta { font-size:10px; color:var(--dsw-alias-label-tertiary,#888); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclAgentRole { margin-top:3px; font-size:11px; color:var(--dsw-alias-label-secondary,#666); line-height:1.4; }
        .dclAgentBtn { min-height:28px; border:0; background:transparent; color:var(--dsw-alias-color-primary,#4356b2); cursor:pointer; font-size:11px; padding:0 6px; }
        .dclAgentDel { min-height:28px; border:0; background:transparent; color:var(--dsw-alias-label-secondary,#666); cursor:pointer; font-size:11px; padding:0 6px; }
        .dclAgentBtn:disabled,.dclAgentDel:disabled,.dclMiniButton:disabled { opacity:.4; cursor:default; }
        .dclPickerBackdrop { position:absolute; inset:45px 0 0; z-index:20; background:rgba(0,0,0,.18); display:flex; justify-content:flex-end; }
        .dclPicker { width:min(520px,100%); height:100%; box-sizing:border-box; background:var(--dsw-alias-bg-layer-1,#fff); border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); box-shadow:-12px 0 28px rgba(0,0,0,.12); padding:16px; display:flex; flex-direction:column; }
        .dclPickerHead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
        .dclPickerTitle { font-size:16px; font-weight:680; }
        .dclPickerHint { font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
        .dclPickerResults { flex:1; min-height:0; overflow-y:auto; margin-top:10px; }
        .dclSessionRow { display:flex; align-items:center; gap:10px; width:100%; box-sizing:border-box; border:0; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.06)); background:transparent; color:inherit; padding:9px 8px; text-align:left; cursor:pointer; }
        .dclSessionRow:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04)); }
        .dclSessionRow:disabled { opacity:.55; cursor:default; }
        .dclSessionInfo { flex:1; min-width:0; }
        .dclSessionTitle { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclSessionMeta { font-size:10px; color:var(--dsw-alias-label-tertiary,#888); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclBriefCard { margin:4px 0 18px; padding:14px 15px; border:1px solid color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 20%,transparent); border-radius:12px; background:color-mix(in srgb,var(--dsw-alias-color-primary,#5870d8) 5%,var(--dsw-alias-bg-layer-1,#fff)); }
        .dclBriefEyebrow { color:var(--dsw-alias-color-primary,#5870d8); font-size:10px; font-weight:700; letter-spacing:.04em; }
        .dclBriefPurpose { margin:5px 0 0; font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary,#555); }
        .dclCharterSection { margin-bottom:16px; }
        .dclCharterLabel { margin-bottom:5px; font-size:10px; font-weight:700; color:var(--dsw-alias-label-tertiary,#888); letter-spacing:.04em; text-transform:uppercase; }
        .dclCharterText { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.62 inherit; color:var(--dsw-alias-label-primary,#1a1a1a); }
        .dclSourceCard { padding:10px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.09)); border-radius:9px; background:var(--dsw-alias-bg-layer-2,#f7f7f8); }
        .dclSourceName { font-size:11px; font-weight:650; overflow-wrap:anywhere; }
        .dclSourceMeta { margin-top:4px; font-size:10px; color:var(--dsw-alias-label-tertiary,#888); overflow-wrap:anywhere; }
        .dclFormField { display:block; margin-bottom:12px; }
        .dclFormLabel { display:block; margin-bottom:5px; font-size:10px; font-weight:650; color:var(--dsw-alias-label-secondary,#666); }
        .dclFormTextArea { width:100%; min-height:86px; resize:vertical; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14)); border-radius:8px; background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; padding:8px 10px; font:12px/1.55 inherit; }
        .dclFormTextArea.large { min-height:220px; }
        .dclSettingsActions { display:flex; justify-content:flex-end; gap:7px; margin-top:14px; }
        .dclTrash { margin-top:14px; border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); padding-top:8px; }
        .dclTrash summary { cursor:pointer; margin:0 6px 6px; color:var(--dsw-alias-label-tertiary,#888); font-size:10px; font-weight:650; }
        .dclTrashRow { display:flex; align-items:center; gap:5px; padding:5px 6px; }
        .dclTrashName { min-width:0; flex:1; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclConversationOrigin { margin:10px 20px; padding:12px 16px; border:1px solid var(--dsw-alias-border-l2,#ddd); border-radius:12px; font-size:12px; }
        .dclConversationOrigin summary { cursor:pointer; }
        .dclConversationOrigin blockquote { margin:10px 0; padding-left:12px; border-left:2px solid var(--dsw-alias-border-l2,#ddd); white-space:pre-wrap; overflow-wrap:anywhere; max-height:220px; overflow:auto; }
        .dclBackgroundConversations { display:flex; flex-wrap:wrap; gap:8px; padding:8px 20px; font-size:12px; align-items:center; }
        .dclMiniButton { min-height:26px; border:0; border-radius:7px; background:transparent; color:var(--dsw-alias-color-primary,#4356b2); cursor:pointer; font:inherit; font-size:10px; padding:0 6px; }
        .dclMiniButton:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); }
        .dclLedgerToolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
        .dclLedgerList { display:flex; flex-direction:column; gap:8px; }
        .dclLedgerCard { border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.09)); border-radius:10px; padding:10px; background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclLedgerCard.closed { opacity:.72; }
        .dclMemory { font-size:12px; }
        .dclMemory .dclAgentMeta { white-space:normal; overflow:visible; text-overflow:clip; overflow-wrap:anywhere; }
        .dclMemoryHeading { display:flex; align-items:center; gap:8px; justify-content:space-between; }
        .dclMemoryVersion { flex-shrink:0; font-size:11px; color:var(--dsw-alias-color-primary,#5870d8); }
        .dclMemoryCard { margin:8px 0; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); padding:10px; border-radius:10px; }
        .dclMemory summary { cursor:pointer; overflow-wrap:anywhere; line-height:1.7; }
        .dclMemoryStatus { display:inline-block; font-size:10px; padding:1px 6px; border-radius:5px; margin-right:6px; background:var(--dsw-alias-bg-layer-2,#f2f2f3); }
        .dclMemoryStatus.pending { color:var(--dsw-alias-color-primary,#5870d8); }
        .dclMemoryStatus.changes_requested { color:var(--dsw-alias-state-danger-primary,#b34747); }
        .dclCharterDiff { font-size:11px; white-space:pre-wrap; overflow-wrap:anywhere; margin:8px 0 12px; border-radius:6px; overflow:hidden; }
        .dclCharterDiff > div { padding:4px 8px; }
        .dclCharterDiff .removed { background:rgba(180,60,60,.09); }
        .dclCharterDiff .added { background:rgba(40,150,95,.10); }
        .dclReviewLine { display:flex; flex-wrap:wrap; gap:3px 10px; padding:6px 0; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); }
        .dclReviewLine > p { flex-basis:100%; margin:0; font-size:11px; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--dsw-alias-label-secondary,#666); }
        .dclMemorySources { margin:12px 0; }
        .dclMemorySources blockquote { margin:8px 0; padding:8px 10px; border-left:2px solid var(--dsw-alias-border-l1,#ccc); font-size:11px; }
        .dclMemorySources p { white-space:pre-wrap; overflow-wrap:anywhere; }
        .dclMemoryArchive { margin:12px 0; }
        .dclMemoryConfirm { padding:12px; border:1px solid var(--dsw-alias-color-primary,#5870d8); border-radius:10px; margin-top:12px; }
        .dclLedgerTop { display:flex; align-items:flex-start; gap:7px; }
        .dclLedgerKind { flex:0 0 auto; border-radius:8px; padding:2px 6px; background:var(--dsw-alias-bg-layer-2,#f2f2f3); color:var(--dsw-alias-label-secondary,#666); font-size:9px; font-weight:650; }
        .dclLedgerTitle { flex:1; min-width:0; font-size:12px; font-weight:650; line-height:1.45; }
        .dclLedgerDetails { margin-top:6px; color:var(--dsw-alias-label-secondary,#666); font-size:10px; line-height:1.5; white-space:pre-wrap; }
        .dclLedgerMeta { display:flex; flex-wrap:wrap; gap:5px 9px; margin-top:7px; color:var(--dsw-alias-label-tertiary,#888); font-size:9px; }
        .dclLedgerActions { display:flex; align-items:center; gap:5px; margin-top:8px; }
        .dclLedgerStatus { height:28px; min-width:0; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12)); border-radius:7px; background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; font:inherit; font-size:10px; padding:0 6px; }
        .dclSearchResult { width:100%; text-align:left; border:0; border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.07)); background:transparent; color:inherit; padding:9px 6px; cursor:pointer; }
        .dclSearchResult:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04)); }
        .dclSearchSnippet { margin-top:3px; color:var(--dsw-alias-label-secondary,#666); font-size:10px; line-height:1.45; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
        .dclModelBackdrop { position:fixed; inset:0; z-index:90; background:rgba(0,0,0,.24); display:flex; align-items:center; justify-content:center; padding:24px; }
        .dclModelDialog { width:min(620px,100%); max-height:min(680px,88vh); display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-1,#fff); border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); border-radius:14px; box-shadow:0 18px 48px rgba(0,0,0,.22); }
        .dclModelList { overflow:auto; min-height:0; padding:8px 12px 14px; }
        .dclModelGroup { margin-top:10px; }
        .dclModelGroupTitle { font-size:11px; font-weight:650; color:var(--dsw-alias-label-secondary,#666); padding:4px 6px; }
        .dclModelRow { width:100%; display:flex; justify-content:space-between; gap:12px; border:0; background:transparent; color:inherit; padding:8px; border-radius:8px; text-align:left; cursor:pointer; font:inherit; }
        .dclModelRow:hover,.dclModelRow[aria-checked="true"] { background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05)); }
        /* Native-theme finishing layer. Layout breakpoints use the actual workspace width. */
        .dclBody { --dsw-alias-color-primary:var(--dsw-alias-state-business-primary,#4176e6); --dcl-surface:var(--dsw-alias-bg-layer-1,#fff); --dcl-text:var(--dsw-alias-label-primary,#161920); --dcl-muted:var(--dsw-alias-label-secondary,#626873); --dcl-tint:color-mix(in srgb,var(--dcl-text) 3%,var(--dcl-surface)); --dcl-line:color-mix(in srgb,var(--dcl-text) 9%,transparent); font-family:var(--dsw-font-family,system-ui,sans-serif); font-size:13px; line-height:1.6; isolation:isolate; }
        .dclBody * { box-sizing:border-box; }
        .dclBody :is(button,input,select,textarea) { font-family:inherit; }
        .dclBody :is(button,input,select,textarea,summary):focus-visible { outline:2px solid var(--dsw-alias-color-primary); outline-offset:3px; }
        .dclBody :is(button,input,select,textarea) { transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease; }
        .dclBody :is(button,select):disabled { cursor:not-allowed; }
        .dclBody :is(.dclSide,.dclTimeline,.dclInspectorBody,.dclModelList,.dclPickerResults) { scrollbar-width:thin; scrollbar-color:var(--dcl-line) transparent; }
        .dclSide { width:236px; display:flex; flex-direction:column; padding:20px 14px 14px; background:var(--dcl-tint); border-color:var(--dcl-line); }
        .dclSideHead { margin:0 6px 18px; }
        .dclSideIdentity { display:flex; align-items:center; gap:10px; }
        .dclSideMark { width:34px; height:34px; display:grid; place-items:center; border:1px solid var(--dcl-line); border-radius:11px; color:var(--dcl-muted); background:var(--dcl-surface); }
        .dclSideHint { font-size:11px; color:var(--dcl-muted); margin-top:1px; }
        .dclSideDismiss { display:none; }
        .dclNewRoom { display:flex; gap:8px; align-items:center; justify-content:flex-start; padding:0 13px; height:42px; flex-shrink:0; border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 15%,transparent); border-radius:10px; font-size:13px; background:color-mix(in srgb,var(--dsw-alias-color-primary) 9%,var(--dcl-surface)); color:var(--dsw-alias-color-primary); }
        .dclNewRoom:hover { background:color-mix(in srgb,var(--dsw-alias-color-primary) 14%,var(--dcl-surface)); border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 28%,transparent); }
        .dclNewRoom:disabled { opacity:.55; }
        .dclRoomSection { display:flex; align-items:center; justify-content:space-between; margin:22px 7px 8px; min-height:30px; font-size:11px; letter-spacing:0; color:var(--dcl-muted); }
        .dclRoomSection > span { display:flex; gap:7px; align-items:center; }
        .dclRoomSection small { font-size:10px; font-variant-numeric:tabular-nums; }
        .dclConversationSearch { display:flex; gap:4px; align-items:center; margin:0 0 10px; }
        .dclConversationSearch input { min-width:0; height:36px; }
        .dclRowButton { padding:10px; margin-bottom:3px; border:1px solid transparent; border-radius:9px; }
        .dclRowActive { background:var(--dcl-surface); border-color:var(--dcl-line); box-shadow:0 1px 3px #00000003; }
        .dclRowActive::before { display:none; }
        .dclRoomName { display:flex; gap:8px; align-items:center; font-size:13px; }
        .dclRoomName > span { overflow:hidden; text-overflow:ellipsis; }
        .dclRoomName svg { width:15px; height:15px; flex-shrink:0; color:var(--dcl-muted); }
        .dclRowActive .dclRoomName svg { color:var(--dsw-alias-color-primary); }
        .dclRoomMeta { margin:4px 0 0 23px; font-size:11px; color:var(--dcl-muted); }
        .dclTrash { margin-top:auto; padding-top:18px; border:0; }
        .dclTrash summary { padding:10px 7px; margin:0; font-size:11px; color:var(--dcl-muted); border-top:1px solid var(--dcl-line); }
        .dclMain { container-type:inline-size; container-name:chat; }
        .dclHeader { display:block; padding:0 22px; border-color:var(--dcl-line); }
        .dclHeaderTop { min-height:64px; display:flex; align-items:center; gap:12px; }
        .dclHeaderIntro { flex:1; min-width:0; max-width:none; }
        .dclHeaderName { font-size:16px; font-weight:650; letter-spacing:0; }
        .dclHeaderMode { font-size:11px; color:var(--dcl-muted); margin-top:2px; }
        .dclNavControls { gap:2px; padding-right:8px; border-right:1px solid var(--dcl-line); }
        .dclIconButton { width:34px; height:34px; color:var(--dcl-muted); border-radius:9px; }
        .dclBackButton { width:auto; padding:0 6px; }
        .dclHeaderTools { display:flex; align-items:center; gap:3px; flex-shrink:0; }
        .dclToolButton { position:relative; display:inline-flex; align-items:center; justify-content:center; gap:6px; height:34px; min-width:34px; padding:0 8px; border:0; border-radius:9px; background:transparent; color:var(--dcl-muted); cursor:pointer; font:inherit; font-size:12px; white-space:nowrap; }
        .dclToolButton:hover { background:var(--dcl-tint); color:var(--dcl-text); }
        .dclToolButton[aria-expanded="true"] { color:var(--dsw-alias-color-primary); background:color-mix(in srgb,var(--dsw-alias-color-primary) 9%,var(--dcl-surface)); }
        .dclToolLabel { display:none; }
        .dclToolCount { position:absolute; right:1px; top:-2px; font-size:9px; min-width:14px; border-radius:7px; background:var(--dsw-alias-color-primary); color:white; }
        .dclRoomToolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; min-height:38px; padding-bottom:10px; font-size:11px; }
        .dclSwitch { display:inline-flex; align-items:center; gap:7px; padding:0; background:transparent; color:var(--dcl-muted); border:0; font:inherit; font-size:11px; cursor:pointer; min-height:28px; }
        .dclSwitchTrack { display:inline-flex; align-items:center; width:26px; height:15px; border-radius:9px; padding:2px; background:color-mix(in srgb,var(--dcl-text) 25%,var(--dcl-surface)); }
        .dclSwitchTrack::after { content:""; width:11px; height:11px; border-radius:50%; background:#fff; box-shadow:0 1px 2px #0002; transition:transform .15s ease; }
        .dclSwitch[aria-checked="true"] .dclSwitchTrack { background:var(--dsw-alias-color-primary); }
        .dclSwitch[aria-checked="true"] .dclSwitchTrack::after { transform:translateX(11px); }
        .dclPolicy { background:transparent; border-left:1px solid var(--dcl-line); border-radius:0; padding:0 0 0 12px; color:var(--dcl-muted); }
        .dclPolicy svg { width:14px; height:14px; }
        .dclPolicySelect { font-weight:400; font-size:11px; max-width:150px; min-height:28px; }
        .dclRoomState { display:flex; align-items:center; gap:6px; margin-left:auto; color:var(--dcl-muted); white-space:nowrap; }
        .dclTimeline { padding:26px 30px 14px; width:100%; overflow-x:hidden; }
        .dclThread { width:min(800px,100%); }
        .dclDateDivider { display:flex; align-items:center; gap:16px; margin:4px 0 28px; color:var(--dcl-muted); font-size:11px; }
        .dclDateDivider::before,.dclDateDivider::after { content:""; height:1px; background:var(--dcl-line); flex:1; }
        .dclMsg { grid-template-columns:34px minmax(0,1fr); column-gap:12px; margin-bottom:34px; }
        .dclMsg.causal::before { display:none; }
        .dclMsgAvatar,.dclAgentAvatar { background:color-mix(in srgb,var(--dcl-agent-accent,#4176e6) 12%,var(--dcl-surface)); color:color-mix(in srgb,var(--dcl-agent-accent,#4176e6) 25%,var(--dcl-text)); border:1px solid color-mix(in srgb,var(--dcl-agent-accent,#4176e6) 12%,transparent); box-shadow:none; }
        .dclMsgAvatar { width:34px; height:34px; border-radius:12px; font-size:12px; }
        .dclMsgMeta { min-height:23px; margin:0 0 6px; gap:8px; flex-wrap:wrap; font-size:11px; color:var(--dcl-muted); }
        .dclMsgAuthor { font-size:13px; font-weight:600; }
        .dclMsgText { background:var(--dcl-tint); border:0; padding:11px 14px; border-radius:0 12px 12px 12px; font-size:var(--dsw-font-markdown-base-font-size,14px); line-height:1.75; }
        .dclMsg.human { max-width:min(85%,640px); margin-bottom:38px; }
        .dclMsg.human .dclMsgText { background:color-mix(in srgb,var(--dsw-alias-color-primary) 8%,var(--dcl-surface)); border-radius:12px 0 12px 12px; }
        .dclMsg.highlighted .dclMsgText { box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-color-primary) 45%,transparent); }
        .dclMsgTime { margin-left:2px; font-variant-numeric:tabular-nums; }
        .dclReplyMeta { font-size:11px; color:var(--dcl-muted); }
        .dclReplyLink { display:inline-flex; align-items:center; gap:4px; padding:0; border:0; background:transparent; font:inherit; color:inherit; cursor:pointer; }
        .dclReplyLink:hover { color:var(--dsw-alias-color-primary); }
        .dclReplyLink svg { width:12px; height:12px; }
        .dclMsgActions { position:absolute; bottom:-28px; left:44px; margin:0; opacity:0; min-height:24px; }
        .dclMsg.human .dclMsgActions { left:auto; right:0; }
        .dclMsg:focus-within .dclMsgActions,.dclMsg:hover .dclMsgActions { opacity:1; }
        .dclMsgAction { font-size:11px; display:inline-flex; align-items:center; gap:4px; }
        .dclMsgAction svg { width:13px; height:13px; }
        .dclMsgActions:has(.failed) { opacity:1; }
        .dclDeliveryItem,.dclMsgMention { font-size:11px; }
        .dclDelivery { margin-top:6px; }
        .dclComposerWrap { padding:8px 30px 20px; }
        .dclComposer { width:min(800px,100%); border:1px solid color-mix(in srgb,var(--dcl-text) 15%,transparent); border-radius:16px; padding:10px 12px 10px; box-shadow:0 4px 16px #00000005; }
        .dclMentionBar { gap:5px; padding:0 0 8px; mask-image:linear-gradient(to right,#000 calc(100% - 12px),transparent); }
        .dclMention { font-size:11px; min-height:28px; border-color:transparent; border-radius:7px; background:var(--dcl-tint); padding:3px 8px; }
        .dclMentionOn { background:color-mix(in srgb,var(--dsw-alias-color-primary) 9%,var(--dcl-surface)); border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 18%,transparent); }
        .dclRouteHint { display:inline-flex; gap:5px; align-items:center; padding:3px 5px; font-size:11px; color:var(--dcl-muted); white-space:nowrap; flex-shrink:0; }
        .dclRouteHint svg { width:13px; height:13px; }
        .dclTextarea { font-size:14px; min-height:62px; max-height:180px; padding:8px 2px; line-height:1.65; }
        .dclTextarea::placeholder { color:var(--dcl-muted); opacity:.8; }
        .dclComposerFoot { padding:6px 0 0; gap:8px; }
        .dclAudience { min-width:0; font-size:11px; color:var(--dcl-muted); }
        .dclKeyHint { font-size:10px; color:var(--dcl-muted); }
        .dclSend { display:inline-flex; gap:7px; align-items:center; justify-content:center; height:34px; border-radius:10px; font-size:12px; padding:0 12px; }
        .dclSend:disabled { opacity:1; background:var(--dcl-tint); color:var(--dcl-muted); }
        .dclSend:not(:disabled):hover,.dclPrimary:not(:disabled):hover { filter:brightness(.94); }
        .dclInspector { position:relative; flex:0 0 368px; width:368px; z-index:15; box-shadow:none; border-color:var(--dcl-line); }
        .dclInspectorHead { flex:0 0 auto; min-height:78px; padding:18px 20px; border-color:var(--dcl-line); }
        .dclInspectorHead > div { flex:1; min-width:0; }
        .dclInspectorHead .dclAgentMeta { white-space:normal; overflow-wrap:anywhere; }
        .dclInspectorTitle { font-size:15px; font-weight:650; }
        .dclInspectorBody { padding:18px; }
        .dclClose { display:flex; align-items:center; justify-content:center; width:30px; height:30px; font-size:20px; color:var(--dcl-muted); flex-shrink:0; }
        .dclAgentTools { padding:12px; border:1px solid var(--dcl-line); border-radius:12px; background:var(--dcl-tint); gap:9px; margin-bottom:18px; }
        .dclAgentRow { display:grid; grid-template-columns:32px minmax(0,1fr); gap:8px 10px; padding:14px 0; border-radius:0; border-bottom:1px solid var(--dcl-line); }
        .dclAgentRow:hover { background:transparent; }
        .dclAgentRow .dclAgentAvatar { width:32px; height:32px; border-radius:11px; }
        .dclAgentName { font-size:13px; }
        .dclAgentMeta { font-size:11px; color:var(--dcl-muted); line-height:1.6; }
        .dclAgentRole { font-size:12px; margin:6px 0; line-height:1.6; }
        .dclMemberActions { grid-column:2; display:flex; gap:5px; align-items:center; }
        .dclMemberOrder { display:flex; margin-left:auto; gap:3px; }
        .dclAgentBtn,.dclAgentDel,.dclMiniButton { border-radius:6px; }
        .dclAgentBtn:hover,.dclAgentDel:hover { background:var(--dcl-tint); }
        .dclAgentDel:hover { color:var(--dsw-alias-state-error-primary,#b42318); }
        .dclModelTrigger { background:var(--dcl-tint); border:1px solid var(--dcl-line); color:var(--dcl-text); text-align:left; padding:5px 8px; max-width:100%; overflow-wrap:anywhere; }
        .dclInput,.dclSelect { height:38px; font-size:12px; border-color:var(--dcl-line); border-radius:9px; }
        .dclFormField { margin-bottom:18px; }
        .dclFormLabel { font-size:12px; font-weight:500; color:var(--dcl-text); margin-bottom:7px; }
        .dclFormTextArea { font-family:inherit; font-size:13px; line-height:1.7; padding:10px 12px; border-color:var(--dcl-line); border-radius:9px; }
        .dclPrimary,.dclSecondary { font-size:12px; height:36px; border-radius:9px; }
        .dclSettingsActions { padding-top:4px; gap:8px; }
        .dclCharterSection { margin-bottom:24px; }
        .dclCharterLabel { font-size:11px; color:var(--dcl-muted); margin-bottom:9px; letter-spacing:0; }
        .dclCharterText { font-family:inherit; font-size:13px; line-height:1.8; }
        .dclSourceCard { padding:12px; background:var(--dcl-tint); border-color:var(--dcl-line); }
        .dclSourceName { font-size:12px; }
        .dclSourceMeta { font-size:11px; color:var(--dcl-muted); line-height:1.7; }
        .dclLedgerCard { padding:14px; border-color:var(--dcl-line); border-radius:12px; }
        .dclLedgerTitle { font-size:13px; }
        .dclLedgerKind { font-size:10px; }
        .dclLedgerDetails { font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
        .dclLedgerMeta { font-size:11px; }
        .dclLedgerStatus { font-size:11px; }
        .dclLedgerActions { flex-wrap:wrap; }
        .dclWorkSummary { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; min-width:0; }
        .dclWorkSummary button { padding:2px 6px; min-height:26px; border:0; border-radius:7px; background:var(--dsw-alias-bg-layer-2,#f5f5f6); color:var(--dsw-alias-label-secondary,#666); font:inherit; font-size:11px; cursor:pointer; }
        .dclWorkSummary button.attention { color:var(--dsw-alias-state-warning-primary,#9a650b); }
        .dclLedgerFilter { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
        .dclLedgerFilter .dclSelect { flex:1; min-width:0; }
        .dclLedgerCard.focused { outline:2px solid var(--dsw-alias-color-primary,#5870d8); outline-offset:2px; }
        .dclLedgerStatusBadge { display:inline-flex; align-items:center; color:var(--dsw-alias-label-secondary,#666); font-size:11px; margin-top:6px; }
        .dclLedgerStatusBadge.attention,.dclLedgerWarning { color:var(--dsw-alias-state-warning-primary,#9a650b); }
        .dclLedgerWarning { margin-top:8px; font-size:11px; line-height:1.55; overflow-wrap:anywhere; }
        .dclLedgerRecord { margin-top:9px; padding:8px 10px; border-left:2px solid var(--dsw-alias-border-l1,rgba(0,0,0,.16)); background:var(--dsw-alias-bg-base,#fafafa); border-radius:0 7px 7px 0; }
        .dclLedgerRecord strong { font-size:11px; font-weight:650; }
        .dclLedgerRecord p { margin:4px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; line-height:1.6; }
        .dclLedgerMore { margin-top:10px; font-size:11px; }
        .dclLedgerMore > summary { cursor:pointer; color:var(--dsw-alias-label-secondary,#666); padding:3px 0; }
        .dclLedgerHistory { list-style:none; padding:0; margin:10px 0 0; display:grid; gap:12px; }
        .dclLedgerHistory li { border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08)); padding-top:9px; }
        .dclLedgerHistoryMeta { font-size:10px; color:var(--dsw-alias-label-tertiary,#888); line-height:1.7; overflow-wrap:anywhere; }
        .dclLedgerSnapshot { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:11px; line-height:1.65; margin:6px 0; }
        .dclLedgerCompare { display:grid; gap:12px; }
        .dclLedgerCompare section { min-width:0; padding:10px 12px; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1)); border-radius:9px; }
        .dclLedgerConfirm { margin:0; font-size:12px; line-height:1.65; }
        .dclSearchResult { padding:14px 8px; border-radius:8px; }
        .dclSearchSnippet { font-size:12px; line-height:1.7; margin-top:6px; }
        .dclEmpty { padding:40px 18px; font-size:13px; color:var(--dcl-muted); line-height:1.8; }
        .dclEmptyIcon { display:grid; place-items:center; width:48px; height:48px; margin:0 auto 16px; border:1px solid var(--dcl-line); border-radius:15px; background:var(--dcl-tint); }
        .dclEmptyIcon svg { width:22px; height:22px; }
        .dclEmptyTitle { font-size:14px; font-weight:600; color:var(--dcl-text); margin-bottom:6px; }
        .dclEmptyHint { font-size:12px; max-width:250px; margin:0 auto; }
        .dclEmpty .dclSecondary { margin-top:18px; }
        .dclModelBackdrop { padding:20px; background:#10182838; backdrop-filter:blur(3px); }
        .dclModelDialog { border-radius:18px; max-height:calc(100dvh - 40px); box-shadow:0 20px 70px #0003; }
        .dclModelList { padding:20px; }
        .dclModelRow { align-items:center; border:1px solid transparent; min-width:0; gap:8px; }
        .dclModelRow[aria-checked="true"] { background:color-mix(in srgb,var(--dsw-alias-color-primary) 8%,var(--dcl-surface)); border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 22%,transparent); }
        .dclModelRowName { flex:1; min-width:0; overflow-wrap:anywhere; }
        .dclModelRow .dclAgentMeta { max-width:45%; font-size:10px; }
        .dclModelSelected { width:16px; height:16px; display:flex; flex-shrink:0; color:var(--dsw-alias-color-primary); }
        /* Creation is a separate task surface, never a form squeezed into navigation. */
        .dclGroupLabel { display:flex; align-items:center; justify-content:space-between; color:var(--dcl-muted); font-size:10px; padding-left:8px; margin-bottom:3px; }
        .dclGroupLabel .dclIconButton { width:28px; height:28px; }
        .dclGroupSwitcher { position:relative; margin-bottom:12px; flex-shrink:0; }
        .dclGroupTrigger { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; min-height:62px; padding:10px; border:1px solid var(--dcl-line); border-radius:11px; background:var(--dcl-surface); }
        .dclGroupTrigger::-webkit-details-marker { display:none; }
        .dclGroupTrigger > svg { flex-shrink:0; color:var(--dcl-muted); }
        .dclGroupTrigger > span { flex:1; min-width:0; }
        .dclGroupTrigger strong { display:block; font-size:12px; font-weight:650; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        .dclGroupTrigger small { display:block; font-size:10px; color:var(--dcl-muted); margin-top:2px; }
        .dclGroupSwitcher[open] .dclGroupTrigger { border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 45%,var(--dcl-line)); }
        .dclGroupPopover { position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:22; padding:6px; border:1px solid var(--dcl-line); border-radius:12px; box-shadow:0 10px 30px #0002; background:var(--dcl-surface); }
        .dclGroupOptions { max-height:220px; overflow:auto; }
        .dclGroupOption,.dclGroupAdd { display:flex; align-items:center; gap:8px; width:100%; padding:10px 8px; min-height:40px; font:inherit; font-size:12px; text-align:left; color:inherit; border:0; border-radius:7px; background:transparent; cursor:pointer; }
        .dclGroupOption:hover,.dclGroupAdd:hover { background:var(--dcl-tint); }
        .dclGroupOption[aria-current="true"] { background:color-mix(in srgb,var(--dsw-alias-color-primary) 8%,var(--dcl-surface)); }
        .dclGroupOption > span { min-width:0; flex:1; overflow-wrap:anywhere; }
        .dclGroupOption small { display:block; color:var(--dcl-muted); font-size:10px; margin-top:2px; }
        .dclGroupOption svg { flex-shrink:0; width:14px; color:var(--dsw-alias-color-primary); }
        .dclGroupAdd { margin-top:5px; border-top:1px solid var(--dcl-line); border-radius:0 0 7px 7px; color:var(--dsw-alias-color-primary); }
        .dclGroupSearch { margin-bottom:6px; }
        .dclCreateDialog { width:min(500px,100%); border-radius:16px; overflow:hidden; }
        .dclCreateHeader { display:flex; align-items:flex-start; gap:12px; padding:24px 24px 20px; }
        .dclCreateMark { width:38px; height:38px; display:grid; place-items:center; flex-shrink:0; background:var(--dcl-tint); border:1px solid var(--dcl-line); border-radius:11px; color:var(--dcl-muted); }
        .dclCreateMark svg { width:20px; height:20px; }
        .dclCreateIntro { flex:1; min-width:0; }
        .dclCreateIntro h2 { margin:0 0 4px; font-size:17px; font-weight:650; letter-spacing:-.02em; }
        .dclCreateIntro p { margin:0; color:var(--dcl-muted); font-size:12px; line-height:1.7; }
        .dclCreateHeader .dclIconButton { margin:-6px -8px 0 0; }
        .dclCreateFields { padding:0 24px 22px; overflow:auto; min-height:0; }
        .dclCreateFields .dclFormField { margin-bottom:20px; }
        .dclCreateFields .dclFormLabel { font-size:12px; font-weight:600; margin-bottom:8px; color:var(--dcl-text); }
        .dclCreateFields .dclInput { height:42px; font-size:13px; border-radius:9px; padding:0 12px; }
        .dclCreateFields .dclInput[aria-invalid="true"] { border-color:var(--dsw-alias-state-error-primary,#b42318); }
        .dclCreateChoices { border:0; padding:0; margin:0 0 16px; min-width:0; display:grid; gap:10px; }
        .dclCreateChoices legend { padding:0 0 9px; font-size:12px; font-weight:600; }
        .dclCreateChoice { display:flex; align-items:flex-start; gap:11px; padding:14px; border:1px solid var(--dcl-line); border-radius:10px; cursor:pointer; }
        .dclCreateChoice:has(input:checked) { background:color-mix(in srgb,var(--dsw-alias-color-primary) 6%,var(--dcl-surface)); border-color:color-mix(in srgb,var(--dsw-alias-color-primary) 60%,var(--dcl-line)); }
        .dclCreateChoice:has(input:focus-visible) { outline:2px solid var(--dsw-alias-color-primary); outline-offset:3px; }
        .dclCreateChoice input { accent-color:var(--dsw-alias-color-primary); width:16px; height:16px; margin:3px 0 0; flex-shrink:0; }
        .dclCreateChoice > span { min-width:0; }
        .dclCreateChoice strong { display:block; font-size:13px; font-weight:600; }
        .dclCreateChoice small { display:block; color:var(--dcl-muted); font-size:11px; line-height:1.7; margin-top:3px; overflow-wrap:anywhere; }
        .dclCreateMembers { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; margin-top:10px; }
        .dclCreateMembers span { border:1px solid var(--dcl-line); background:var(--dcl-surface); padding:3px 7px; border-radius:6px; font-size:10px; color:var(--dcl-muted); text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dclCreateNote { display:flex; gap:8px; align-items:flex-start; color:var(--dcl-muted); font-size:11px; line-height:1.8; margin:0; }
        .dclCreateNote svg { flex-shrink:0; margin-top:3px; width:14px; height:14px; }
        .dclCreateError { padding:10px 12px; margin:14px 0 0; border-radius:8px; background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b42318) 6%,var(--dcl-surface)); color:var(--dsw-alias-state-error-primary,#b42318); font-size:12px; overflow-wrap:anywhere; }
        .dclCreateFooter { flex-shrink:0; padding:16px 24px; border-top:1px solid var(--dcl-line); display:flex; align-items:center; justify-content:flex-end; gap:10px; background:var(--dcl-tint); }
        .dclCreateFooter button { min-height:38px; padding-inline:17px; font-size:12px; }
        .dclConversationWelcome { text-align:center; padding:clamp(32px,8vh,84px) 20px 26px; color:var(--dcl-text); }
        .dclWelcomeMark { width:48px; height:48px; display:grid; place-items:center; margin:0 auto 18px; border:1px solid var(--dcl-line); background:var(--dcl-tint); border-radius:15px; color:var(--dcl-muted); }
        .dclWelcomeMark svg { width:23px; height:23px; }
        .dclConversationWelcome h3 { font-size:20px; font-weight:620; letter-spacing:-.025em; margin:0 0 10px; }
        .dclConversationWelcome p { margin:0 auto; max-width:380px; font-size:12px; line-height:1.9; color:var(--dcl-muted); }
        .dclWelcomeMembers { display:grid; grid-template-columns:repeat(3,minmax(0,auto)); justify-content:center; gap:7px; max-width:440px; margin:20px auto 16px; }
        .dclWelcomeMember { display:flex; align-items:center; gap:6px; min-height:30px; padding:3px 9px; border:1px solid var(--dcl-line); background:var(--dcl-surface); border-radius:8px; color:var(--dcl-muted); font:inherit; font-size:11px; cursor:pointer; }
        .dclWelcomeMember:hover { background:var(--dcl-tint); }
        .dclWelcomeMember > span { width:18px; height:18px; display:grid; place-items:center; background:var(--dcl-tint); color:var(--dcl-text); border-radius:5px; font-size:10px; }
        .dclWelcomeStart { display:inline-flex; align-items:center; gap:3px; margin-top:10px; }
        .dclWelcomeStart svg { width:12px; height:12px; }
        .dclConversationWelcome .dclWelcomeFootnote { margin-top:16px; font-size:11px; }
        .dclConversationWelcome > .dclPrimary { margin-top:20px; min-height:38px; }
        @container (max-width:680px) { .dclCreateHeader { padding:20px 18px 18px; } .dclCreateFields { padding:0 18px 18px; } .dclCreateFooter { padding:14px 18px; } .dclCreateIntro h2 { font-size:16px; } .dclConversationWelcome { padding:32px 6px 20px; } .dclConversationWelcome h3 { font-size:18px; } }
        .dclPickerBackdrop { inset:0; z-index:30; background:#10182838; }
        .dclPicker { padding:22px; }
        .dclPickerHint { font-size:12px; }
        .dclSessionRow { padding:13px 8px; }
        .dclSessionTitle { font-size:13px; }
        .dclSessionMeta { font-size:11px; }
        .dclError { display:flex; align-items:center; gap:9px; padding:9px 18px; font-size:12px; }
        .dclError > span { flex:1; }
        .dclNotice { padding:9px 18px; font-size:12px; background:var(--dcl-tint); }
        .dclScrim { display:none; }
        @container chat (min-width:1000px) { .dclToolLabel { display:inline; } }
        @container chat (max-width:620px) { .dclHeader { padding-inline:12px; } .dclHeaderTop { gap:8px; } .dclBackLabel { display:none; } .dclNavControls { padding-right:4px; } .dclHeaderTools { gap:0; } .dclToolButton { padding:0 5px; min-width:30px; } .dclHeaderName { font-size:14px; } .dclRoomState { display:none; } .dclTimeline { padding:22px 16px 10px; } .dclComposerWrap { padding:8px 12px 14px; } .dclKeyHint { display:none; } .dclMsg { column-gap:9px; } }
        @container chat (max-width:390px) { .dclHeaderTop { flex-wrap:wrap; padding-top:8px; gap:6px; } .dclHeaderIntro { min-width:130px; } .dclHeaderTools { margin-left:auto; } .dclHeaderMode { font-size:10px; } .dclRoomToolbar { gap:9px; } .dclPolicy { padding-left:9px; } .dclSendLabel { display:none; } }
        @container (max-width:1119px) { .dclInspector { position:absolute; right:0; top:0; bottom:0; width:min(380px,100%); box-shadow:-12px 0 40px #00000014; } .dclInspectorScrim { display:block; position:absolute; inset:0; z-index:14; border:0; background:#10182825; } }
        @container (max-width:680px) { .dclSide { position:absolute; inset:0 auto 0 0; width:min(280px,86%); z-index:18; box-shadow:12px 0 40px #00000014; } .dclSideDismiss { display:flex; } .dclSidebarScrim { display:block; position:absolute; inset:0; z-index:17; border:0; background:#10182838; } .dclModelBackdrop { padding:12px; } .dclModelDialog { max-height:calc(100dvh - 24px); border-radius:14px; } .dclModelList { padding:16px; } }
        .dclMarkdown { white-space:normal; line-height:1.75; min-width:0; }
        .dclMarkdown p { margin:0 0 .8em; white-space:pre-wrap; }
        .dclMarkdown > :last-child { margin-bottom:0; }
        .dclMarkdown h2,.dclMarkdown h3,.dclMarkdown h4 { margin:1em 0 .45em; line-height:1.45; font-size:1.08em; font-weight:650; }
        .dclMarkdown > :first-child { margin-top:0; }
        .dclExportDescription { font-size:12px; line-height:1.7; color:var(--dcl-muted); white-space:normal; margin:10px 0; }
        .dclExportSaved { display:grid; gap:9px; text-align:left; padding:12px; margin:12px 0; border:1px solid var(--dcl-line); border-radius:9px; background:var(--dcl-tint); min-width:0; }
        .dclExportSaved .dclField { display:grid; gap:6px; font-size:12px; min-width:0; }
        .dclExportSaved input { width:100%; min-width:0; box-sizing:border-box; }
        .dclExportSaved button { justify-self:start; }
        .dclMarkdown ul,.dclMarkdown ol { margin:.5em 0 .9em; padding-left:1.5em; }
        .dclMarkdown li { margin:.25em 0; }
        .dclMarkdown blockquote { margin:.8em 0; padding:.2em .9em; border-left:3px solid var(--dcl-line); color:var(--dcl-muted); }
        .dclMarkdown code { font-size:.88em; border-radius:4px; padding:2px 4px; background:var(--dcl-tint); overflow-wrap:anywhere; }
        .dclMarkdown pre { overflow:auto; max-width:100%; padding:12px; border:1px solid var(--dcl-line); border-radius:8px; white-space:pre; background:var(--dcl-tint); }
        .dclMarkdown pre code { padding:0; background:none; overflow-wrap:normal; }
        .dclTableScroll { max-width:100%; overflow:auto; margin:.8em 0; }
        .dclMarkdown table { border-collapse:collapse; min-width:100%; font-size:.92em; }
        .dclMarkdown th,.dclMarkdown td { border:1px solid var(--dcl-line); padding:7px 9px; text-align:left; min-width:90px; }
        .dclMarkdown th { background:var(--dcl-tint); font-weight:600; }
        .dclMarkdown a,.dclInlineFile { color:var(--dsw-alias-color-primary,#5870d8); text-decoration:underline; text-underline-offset:3px; }
        .dclInlineFile { border:0; background:none; padding:0; font:inherit; cursor:pointer; text-align:left; overflow-wrap:anywhere; }
        .dclExpandText { border:0; padding:7px 0 0; color:var(--dcl-muted); background:none; font:inherit; font-size:12px; cursor:pointer; }
        .dclRoundStatus { margin:10px 18px 0; border:1px solid var(--dcl-line); border-left:3px solid var(--dsw-alias-state-warning-primary,#9a650b); border-radius:9px; padding:10px 12px; font-size:12px; background:var(--dcl-tint); }
        .dclRoundStatus p { margin:4px 0 8px; color:var(--dcl-muted); line-height:1.6; }
        .dclRoundActions { display:flex; gap:8px; flex-wrap:wrap; }
        .dclPolicyDetails { display:flex; align-items:center; border:0; padding:4px; border-radius:6px; background:none; color:inherit; cursor:pointer; }
        .dclPolicyDetails:hover { background:var(--dcl-tint); }
        .dclBody button:focus-visible,.dclBody a:focus-visible { outline:2px solid var(--dsw-alias-color-primary,#5870d8); outline-offset:3px; }
        @container chat (max-width:620px) { .dclMentionBar { flex-wrap:wrap; max-height:78px; overflow:auto; } .dclComposerWrap { padding-top:6px; } .dclMsg.human { max-width:92%; } .dclRoundStatus { margin-inline:12px; } }
        @media (hover:none) { .dclMsgActions { opacity:1; } .dclMsgAction { min-height:30px; } }
        @media (prefers-reduced-motion:reduce) { .dclBody *, .dclBody *::after { transition:none !important; animation:none !important; scroll-behavior:auto !important; } }
      `;
      style.textContent+=`
        .dclStartWorkspace { width:min(100%,860px); box-sizing:border-box; padding:28px clamp(16px,4vw,48px); margin:0 auto; overflow:auto; }
        .dclStartHeader { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:24px; }
        .dclStartHeader h2 { margin:0 0 8px; font-size:23px; letter-spacing:-.025em; }
        .dclStartHeader p { margin:0; color:var(--dsw-alias-label-secondary,#666); line-height:1.7; }
        .dclStartSummary,.dclStartActions,.dclStartSaveRoster { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin:16px 0; }
        .dclStartActions { position:sticky; bottom:0; z-index:2; padding:14px 0; margin-bottom:0; border-top:1px solid var(--dsw-alias-border-l2,#ddd); background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclStartActions>span { margin-right:auto; }
        .dclStartTeam { border:1px solid var(--dsw-alias-border-l2,#ddd); border-radius:14px; padding:16px; margin:16px 0; }
        .dclStartMember { border-bottom:1px solid var(--dsw-alias-border-l2,#ddd); padding:14px 0; }
        .dclStartMemberFields { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
        .dclStartMemberFields .dclInput { flex:1 1 140px; min-width:0; }
        .dclStartWorkspace .dclFormField { display:grid; gap:7px; margin:14px 0; }
        .dclStartWorkspace .dclSelect,.dclStartWorkspace .dclInput { width:100%; box-sizing:border-box; min-width:0; }
        .dclStartEnvironment { background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.025)); border-radius:10px; padding:12px; margin:16px 0; overflow-wrap:anywhere; }
        .dclStartEnvironment summary { cursor:pointer; font-size:12px; }
        .dclStartText { min-height:160px; resize:vertical; font-size:14px; line-height:1.7; }
        .dclStartSaveRoster .dclInput { flex:1 1 180px; }
        .dclDraftRow { margin:3px 10px; border-left:2px solid var(--dsw-alias-color-primary,#5870d8); padding:7px; }
        .dclBatchItem { display:flex; gap:9px; padding:9px 0; align-items:flex-start; overflow-wrap:anywhere; }
        @container (max-width:520px) { .dclStartHeader { flex-direction:column; } .dclStartWorkspace { padding:18px 14px; } }
      `;
      style.textContent+=`
        .dclGlobalNav { display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:5px;border:1px solid var(--dcl-line,rgba(0,0,0,.08));border-radius:10px;margin:12px 0 22px; }
        .dclGlobalNav button { display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:6px;background:none;color:inherit;padding:9px 5px;font:inherit;cursor:pointer; }
        .dclGlobalNav button.active,.dclGlobalNav button:hover { background:var(--dcl-tint,rgba(0,0,0,.05)); }
        .dclHomeSide>.dclAgentMeta { padding:10px 5px;line-height:1.8; }
        .dclManagementHeader { display:flex;align-items:center;gap:12px;min-height:58px;box-sizing:border-box;flex-shrink:0; }
        .dclManagementMain { overflow:auto; }
        .dclManagementMain>.dclManagementHeader { position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-layer-1,#fff); }
        .dclStartWorkspace { width:min(100%,900px);padding:36px clamp(20px,4vw,48px) 24px; }
        .dclEyebrow { display:block;color:var(--dcl-muted,#6a6a6a);font-size:11px;letter-spacing:.06em;margin-bottom:10px; }
        .dclStartHeader { margin-bottom:30px; }
        .dclStartHeader h2 { font-size:25px;line-height:1.35; }
        .dclStartHeader p { max-width:46em;font-size:13px; }
        .dclStartWorkspace .dclInput { min-height:40px;font-size:13px; }
        .dclTopicPrompt { font-weight:600; }
        .dclTopicPrompt .dclStartText { min-height:175px;font-size:15px;padding:16px;font-weight:400;line-height:1.8;border-radius:13px; }
        .dclTopicTitle { font-size:12px;color:var(--dcl-muted,#666);margin:12px 0 24px; }
        .dclTopicTitle summary,.dclCandidateRemainder summary { cursor:pointer; }
        .dclTeamSummarySection { border-top:1px solid var(--dcl-line,rgba(0,0,0,.09));padding:22px 0 6px;margin-top:25px; }
        .dclSectionHeading { display:flex;align-items:center;justify-content:space-between;gap:16px; }
        .dclSectionHeading h3 { margin:0;font-size:14px; }.dclSectionHeading p { margin:5px 0; }
        .dclCount { display:inline-grid;place-items:center;min-width:23px;height:23px;border-radius:7px;background:var(--dcl-tint,rgba(0,0,0,.04));margin-left:8px;font-size:11px; }
        .dclTeamEmpty { padding:24px 18px;border:1px dashed var(--dcl-line,rgba(0,0,0,.13));border-radius:12px;margin:16px 0;background:var(--dcl-tint,rgba(0,0,0,.02)); }
        .dclTeamEmpty strong { font-size:13px; }.dclTeamEmpty p { color:var(--dcl-muted,#666);font-size:12px;margin:6px 0 0; }
        .dclSelectedCards { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,275px),1fr));gap:10px;margin:16px 0; }
        .dclSelectedCard { display:flex;gap:10px;align-items:flex-start;border:1px solid var(--dcl-line,rgba(0,0,0,.09));border-radius:11px;padding:13px;min-width:0; }
        .dclSelectedAvatar,.dclTeamAvatar,.dclGroupAvatar { display:grid;place-items:center;flex-shrink:0;width:31px;height:31px;border-radius:9px;background:var(--dcl-tint,rgba(0,0,0,.05));font-size:13px;font-weight:600; }
        .dclSelectedInfo { display:flex;flex-direction:column;gap:3px;min-width:0;flex:1; }.dclSelectedInfo strong { font-size:13px;overflow-wrap:anywhere; }.dclSelectedInfo span,.dclSelectedInfo small { color:var(--dcl-muted,#666);font-size:11px;overflow-wrap:anywhere; }
        .dclSelectedActions { display:flex;flex-direction:column;gap:2px; }.dclSelectedActions button { min-height:25px;font-size:11px; }
        .dclInlineActions { display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:10px 0; }
        .dclCandidateRemainder { margin:15px 0;font-size:12px;color:var(--dcl-muted,#666); }.dclCandidateRemainder button { margin:6px 5px 0 0; }
        .dclAutoCollaboration { display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0;cursor:pointer; }.dclAutoCollaboration small { font-size:11px;color:var(--dcl-muted,#666); }
        .dclStartActions { padding:16px 0 8px;gap:12px;margin-top:24px; }.dclStartActions .dclPrimary { min-height:40px;min-width:120px; }
        .dclShortcut { display:block;text-align:right;color:var(--dcl-muted,#777);font-size:10px;padding-top:8px; }
        .dclPreflightIssues { padding:16px;background:var(--dcl-tint,rgba(0,0,0,.03));border:1px solid var(--dcl-line,#ddd);border-radius:12px;margin:16px 0; }.dclPreflightIssues h3 { font-size:14px;margin:0 0 12px; }.dclPreflightIssues>div { padding:12px 0; }.dclPreflightIssues p { color:var(--dcl-muted,#666);margin:5px 0 10px; }
        .dclConflictColumns { display:grid;grid-template-columns:1fr 1fr;gap:16px;width:100%; }.dclDraftConflict { display:block; }.dclConflictSummary { max-height:220px;overflow:auto;overflow-wrap:anywhere; }
        .dclTeamBackdrop { position:fixed;inset:0;z-index:1800;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,20,30,.22);backdrop-filter:blur(3px); }
        .dclTeamDialog { display:flex;flex-direction:column;gap:16px;box-sizing:border-box;width:min(700px,100%);max-height:min(88dvh,980px);padding:24px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dcl-line,#ddd);border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 24px 80px rgba(0,0,0,.15); }.dclTeamDialog>* { flex-shrink:0; }.dclTeamDialog>.dclTeamCandidates { max-height:min(33dvh,280px); }.dclTeamDialog>.dclTeamSelection { max-height:210px;overflow:auto; }
        .dclTeamHeader,.dclGroupHeader { display:flex;align-items:flex-start;justify-content:space-between;gap:16px; }.dclTeamHeader h2,.dclGroupHeader h2 { font-size:23px;line-height:1.4;letter-spacing:-.02em;margin:0; }.dclTeamHeader p,.dclGroupHeader p { color:var(--dcl-muted,#666);font-size:13px;margin:7px 0; }
        .dclTeamEditor { width:100%;min-width:0; }.dclTeamEditor h3 { margin:0;font-size:18px; }.dclTeamEditor .dclFormField,.dclGroupField { display:grid;gap:7px;margin:17px 0; }
        .dclTeamEditor .dclInput,.dclTeamEditor .dclSelect { min-height:39px;font-size:13px; }.dclTeamEditor textarea { min-height:110px; }
        .dclTeamToolbar,.dclTeamTabs,.dclGroupToolbar,.dclGroupFilters { display:flex;gap:8px;align-items:center;flex-wrap:wrap; }.dclTeamToolbar>.dclInput,.dclGroupToolbar>.dclInput { flex:1 1 190px; }
        .dclTeamTabs { border-bottom:1px solid var(--dcl-line,#ddd);padding-bottom:12px; }.dclTeamTabs [aria-pressed=true],.dclGroupFilters [aria-pressed=true] { background:var(--dsw-alias-interactive-bg-active,#ecf0ff);border-color:var(--dsw-alias-color-primary,#5870d8); }
        .dclTeamCandidates { display:grid;gap:7px;max-height:330px;overflow:auto;overscroll-behavior:contain; }.dclTeamCandidate { display:flex;align-items:flex-start;gap:11px;padding:12px;border:1px solid var(--dcl-line,rgba(0,0,0,.09));border-radius:10px;cursor:pointer;min-width:0; }.dclTeamCandidate:has(input:checked) { border-color:var(--dsw-alias-color-primary,#5870d8);background:var(--dsw-alias-interactive-bg-active,#f4f6ff); }.dclTeamCandidate input { margin-top:5px; }.dclTeamCandidateInfo { flex:1;min-width:0;display:grid;gap:3px; }.dclTeamCandidateInfo strong { overflow-wrap:anywhere; }.dclTeamCandidateInfo small { display:block;font-size:11px;color:var(--dcl-muted,#666);overflow-wrap:anywhere; }
        .dclTeamSelection { border-top:1px solid var(--dcl-line,#ddd);padding-top:12px; }.dclTeamSelection h3 { font-size:13px;margin:0 0 9px; }.dclTeamSelected { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--dcl-line,rgba(0,0,0,.06)); }.dclTeamSelected>div:first-child { min-width:0;overflow-wrap:anywhere; }.dclTeamSelected small { display:block;font-size:11px;color:var(--dcl-muted,#666); }.dclTeamMemberActions { display:flex;gap:5px;flex-shrink:0; }
        .dclTeamActions { display:flex;justify-content:flex-end;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;bottom:-24px;background:var(--dsw-alias-bg-layer-1,#fff);padding:15px 0 5px;border-top:1px solid var(--dcl-line,#ddd);margin-top:12px;z-index:1; }.dclTeamActions .dclPrimary { min-height:38px; }.dclTeamActions>span { margin-right:auto; }
        .dclTeamDirectory { margin:14px 0; }.dclTeamDirectorySummary { display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--dcl-line,#ddd);border-radius:9px; }.dclTeamPath { min-width:0;overflow-wrap:anywhere;font-size:12px; }.dclTeamFolder { display:block;width:100%;text-align:left;padding:12px;border:0;border-bottom:1px solid var(--dcl-line,#eee);background:none;color:inherit;font:inherit;cursor:pointer; }.dclTeamFolder:hover { background:var(--dcl-tint,#f7f7f7); }.dclTeamBreadcrumbs { overflow-wrap:anywhere;font-size:12px;display:flex;gap:8px;flex-wrap:wrap; }
        .dclTeamNativePreview { background:var(--dcl-tint,#fafafa);border:1px solid var(--dcl-line,#ddd);border-radius:10px;padding:14px;overflow-wrap:anywhere; }.dclTeamNativePreview p { font-size:12px;color:var(--dcl-muted,#666); }.dclTeamNativePreview label { display:flex;gap:8px;margin:10px 0; }
        .dclTeamLibrary,.dclGroupHome,.dclGroupSettings { width:min(100%,1050px);box-sizing:border-box;padding:32px clamp(20px,4vw,48px);margin:0 auto; }.dclTeamLibraryList { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:14px;margin:24px 0; }.dclTeamLibraryCard { border:1px solid var(--dcl-line,#ddd);border-radius:13px;padding:18px;overflow-wrap:anywhere; }.dclTeamLibraryCard h3 { margin:0 0 8px;font-size:15px; }.dclTeamLibraryCard p { font-size:12px;color:var(--dcl-muted,#666); }.dclTeamLibraryCard button { margin-right:8px; }
        .dclGroupHeader { margin-bottom:25px; }.dclGroupToolbar { margin:0 0 23px; }.dclGroupCards { display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,245px),1fr));gap:14px; }.dclGroupCard { display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:17px;border:1px solid var(--dcl-line,#ddd);border-radius:13px;background:var(--dsw-alias-bg-layer-1,#fff); }.dclGroupOpen { flex:1 0 100%;display:flex;flex-direction:column;gap:8px;background:none;color:inherit;border:0;text-align:left;font:inherit;cursor:pointer;padding:0 0 14px;min-width:0; }.dclGroupOpen strong { font-size:15px;overflow-wrap:anywhere; }.dclGroupOpen span { font-size:11px;color:var(--dcl-muted,#666); }.dclGroupCardMore { font-size:12px;margin-left:auto;position:relative; }.dclGroupCardMore summary { cursor:pointer;padding:6px; }.dclGroupCardMore[open] { flex:1 0 100%;margin-top:8px;border-top:1px solid var(--dcl-line,#ddd);padding-top:9px; }.dclGroupCardMore button { margin:4px; }
        .dclGroupDrafts { margin-top:32px;padding-top:20px;border-top:1px solid var(--dcl-line,#ddd); }.dclGroupDrafts h3 { font-size:14px; }.dclGroupDraft { display:block;border:0;border-left:2px solid var(--dsw-alias-color-primary,#5870d8);background:var(--dcl-tint,#fafafa);color:inherit;cursor:pointer;font:inherit;padding:12px 16px;margin:10px 0;border-radius:5px;width:100%;text-align:left; }
        .dclGroupForm { border:0;margin:0;padding:0;min-width:0; }.dclGroupForm>.dclGroupField .dclInput { min-height:42px;font-size:14px; }.dclGroupSection,.dclGroupPreselection { margin:25px 0;padding:22px 0;border-top:1px solid var(--dcl-line,#ddd); }.dclGroupSectionHeader { display:flex;gap:12px;justify-content:space-between;align-items:center; }.dclGroupSection h3,.dclGroupPreselection h3 { font-size:14px;margin:0 0 8px; }.dclGroupSection summary { cursor:pointer; }.dclGroupMembers { display:grid;gap:9px; }.dclGroupMember { display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px;border:1px solid var(--dcl-line,#ddd);border-radius:10px; }.dclGroupMember>div { min-width:0; }.dclGroupMember strong { overflow-wrap:anywhere; }.dclGroupMember small { display:block;font-size:11px;color:var(--dcl-muted,#666); }.dclGroupCheck { display:flex;align-items:flex-start;gap:10px;margin:12px 0; }.dclGroupCheck input { margin-top:4px; }.dclGroupActions { display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin:20px 0 0; }.dclGroupActions>span { margin-right:auto; }
        .dclGroupHint,.dclGroupEmpty { font-size:12px;color:var(--dcl-muted,#666);line-height:1.8; }.dclGroupError { color:var(--dsw-alias-state-error-primary,#9b3030);font-size:12px;padding:12px;background:var(--dcl-tint,#fafafa);border-radius:8px; }.dclGroupNotice,.dclGroupLifecycle,.dclGroupConflict { padding:18px;border:1px solid var(--dcl-line,#ddd);background:var(--dcl-tint,#fafafa);border-radius:12px;margin:20px 0;overflow-wrap:anywhere; }.dclGroupLifecycle h3 { margin:0 0 12px; }.dclGroupComparison { width:100%;border-collapse:collapse;font-size:12px; }.dclGroupComparison th,.dclGroupComparison td { text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--dcl-line,#ddd);overflow-wrap:anywhere;max-width:200px; }.dclGroupOverrides { font-size:12px;overflow-wrap:anywhere; }
        .dclGroupConversationDrafts { margin:24px 0;border-top:1px solid var(--dcl-line,#ddd);padding:20px 0; }.dclGroupConversationDrafts summary { cursor:pointer;font-size:14px; }.dclGroupDraftInfo { display:block;font-size:11px;color:var(--dcl-muted,#666);margin-top:5px; }.dclGroupDraftExcerpt { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;margin-top:6px; }
        .dclGroupMembers { grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-top:24px; }.dclGroupMembers>.dclGroupSectionHeader,.dclGroupMembers>p { grid-column:1/-1; }.dclGroupMembers>p { font-size:12px;color:var(--dcl-muted,#666);margin:0 0 8px; }.dclGroupMember { padding:12px;gap:10px;flex-wrap:nowrap; }.dclGroupMember>div { flex:1; }.dclGroupMember p { margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--dcl-muted,#666); }.dclGroupMember>button { flex-shrink:0; }.dclGroupPreselection { display:flex;gap:10px 20px;flex-wrap:wrap; }.dclGroupPreselection>h3,.dclGroupPreselection>p { flex-basis:100%;margin:0; }.dclGroupPreselection>p { font-size:12px;color:var(--dcl-muted,#666); }.dclGroupPreselection>.dclGroupCheck { margin:5px 0; }.dclGroupSection:not([open]) { margin:0;padding:16px 0; }.dclGroupComparison { overflow-x:auto; }.dclGroupComparison table { width:100%;table-layout:fixed;border-collapse:collapse; }
        @container (max-width:700px) { .dclStartWorkspace { padding:24px 18px; }.dclTeamLibrary,.dclGroupHome,.dclGroupSettings { padding:24px 18px; }.dclSectionHeading { align-items:flex-start;flex-wrap:wrap; }.dclSelectedCards { grid-template-columns:1fr; }.dclConflictColumns { grid-template-columns:1fr; }.dclStartHeader h2 { font-size:22px; } }
        @media (max-width:600px) { .dclTeamBackdrop { padding:10px; }.dclTeamDialog { padding:18px;width:100%;max-height:94dvh;border-radius:13px; }.dclTeamToolbar { align-items:stretch; }.dclTeamToolbar>.dclInput { flex-basis:100%; }.dclTeamActions { bottom:-18px; }.dclTeamMemberActions { flex-wrap:wrap; }.dclTeamLibraryList,.dclGroupCards { grid-template-columns:1fr; }.dclGroupHeader { flex-wrap:wrap; } }
      `;
      if (!style.isConnected) document.head.appendChild(style);
    }

    function lineIcon(kind, className = "dclHeaderIcon") {
      const attrs = {
        className,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true
      };
      const paths = {
        plus: ["M12 5v14M5 12h14"],
        close: ["m6 6 12 12M6 18 18 6"],
        search: ["M21 21l-5-5", "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
        users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0", "M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"],
        ledger: ["M9 5H5v16h14V5h-4M9 3h6v4H9z", "m8 13 2 2 5-5M8 18h8"],
        book: ["M12 5v16M12 5C9 2 5 3 2 3v16c3 0 7-1 10 2 3-3 7-2 10-2V3c-3 0-7-1-10 2"],
        settings: ["M4 7h9m4 0h3M4 17h3m4 0h9", "M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0M11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0"],
        shield: ["M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z", "m8 12 3 3 5-6"],
        send: ["M12 19V5m-6 6 6-6 6 6"],
        reply: ["m9 4-5 5 5 5M4 9h9a7 7 0 0 1 7 7v4"],
        edit: ["M12 20H4v-8m11-8 5 5-10 10-6 1 1-6z"],
        copy: ["M9 9h12v12H9zM15 9V3H3v12h6"],
        file: ["M14 2H4v20h16V8zM14 2v6h6M8 13h8M8 17h6"],
        chevron: ["m9 5 7 7-7 7"],
        down: ["m6 9 6 6 6-6"],
        check: ["m5 12 4 4L19 6"]
      };
      if (paths[kind]) return h("svg", attrs, paths[kind].map((d, index) => h("path", { key: index, d })));
      if (kind === "chat") return h("svg", attrs,
        h("path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" }),
        h("path", { d: "M8 9h8M8 13h5" })
      );
      if (kind === "arrow-left") return h("svg", attrs,
        h("path", { d: "m15 18-6-6 6-6" }),
        h("path", { d: "M9 12h10" })
      );
      const opening = kind === "sidebar-open";
      return h("svg", attrs,
        h("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
        h("path", { d: "M9 3v18" }),
        h("path", { d: opening ? "m14 9 3 3-3 3" : "m17 9-3 3 3 3" })
      );
    }

    async function api(path, options = {}) {
      const cache=api.cache??(api.cache=new Map());
      const reading=!options.method||options.method==="GET";
      const cached=reading?cache.get(path):null;
      if(!reading)cache.clear();
      const response = await fetch(BASE + path, {
        method: options.method ?? "GET",
        headers: { "content-type": "application/json", ...(cached?.etag?{"if-none-match":cached.etag}:{}), ...(options.headers ?? {}) },
        body: options.body,
        cache: "no-store"
      });
      if(response.status===304&&cached)return cached.value;
      const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {
        status:response.status, code: data.code, candidates: Array.isArray(data.candidates) ? data.candidates : undefined
      });
      const etag=response.headers?.get?.("etag");
      if(reading&&etag){if(cache.size>=32&&!cache.has(path))cache.delete(cache.keys().next().value);cache.set(path,{etag,value:data.value});}
      return data.value;
    }

    function groupNameIssue(name, rooms) {
      const value=name.trim();
      if(!value)return "";
      if(value.length>120)return "群组名称最多 120 个字符。";
      return rooms.some(room=>!room.deletedAt&&room.name===value) ? "这个名称已被群组或对话使用，请换一个名称。" : "";
    }

    function filterConversations(rooms, query) {
      const needle=query.trim().toLocaleLowerCase();
      return needle ? rooms.filter(room=>room.name.toLocaleLowerCase().includes(needle)) : rooms;
    }

    function withLocalWorkspaceDrafts(workspace) {
      const drafts=[...workspace.drafts];
      try{for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith("dcl:workspace-draft:"))continue;
        const local=JSON.parse(localStorage.getItem(key)??"null");
        if(local?.data?.id&&!drafts.some(d=>d.id===local.data.id)&&(local.pending||local.change>local.saved))drafts.push({...local.data,localOnly:true});
      }}catch{/* Server drafts remain usable when browser storage is unavailable. */}
      return {...workspace,drafts};
    }

    function GroupSwitcher({groups,selected,onSelect,onCreate,onManage,disabled}) {
      groups=groups.filter(group=>!group.archivedAt&&!group.deletedAt).sort((a,b)=>(b.pinnedAt??0)-(a.pinnedAt??0)||(b.lastActivityAt??b.updatedAt??b.createdAt??0)-(a.lastActivityAt??a.updatedAt??a.createdAt??0));
      const root=React.useRef(null);
      const [query,setQuery]=React.useState("");
      const close=(focus=false)=>{if(root.current){root.current.open=false;if(focus)root.current.querySelector("summary")?.focus();}};
      React.useEffect(()=>{
        const outside=event=>{if(root.current?.open&&!root.current.contains(event.target))root.current.open=false;};
        document.addEventListener("pointerdown",outside);
        return()=>document.removeEventListener("pointerdown",outside);
      },[]);
      return h("details",{ref:root,className:"dclGroupSwitcher","data-dcl-group-picker":true,onToggle:event=>{if(!event.currentTarget.open)setQuery("");},onKeyDown:event=>{
        if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close(true);}
        if(event.key==="ArrowDown"&&event.target.tagName==="SUMMARY"){event.preventDefault();root.current.open=true;root.current.querySelector("input,button")?.focus();}
      }},
        h("summary",{className:"dclGroupTrigger","aria-label":`切换群组，当前：${selected?.name??"尚未选择"}`,title:selected?.name},lineIcon("users"),h("span",null,
          h("strong",null,selected?.name??"选择群组"),h("small",null,selected?`${selected.conversationCount??0} 段对话${selected.runningCount?` · ${selected.runningCount} 个协作中`:" · 独立记录"}`:"创建你的第一个团队")),lineIcon("down")),
        h("div",{className:"dclGroupPopover"},
          groups.length>5?h("input",{className:"dclInput dclGroupSearch",value:query,onChange:event=>setQuery(event.target.value),"aria-label":"搜索群组",placeholder:"搜索群组…"}):null,
          h("div",{className:"dclGroupOptions","aria-label":"可切换的群组"},
            filterConversations(groups,query).slice(0,query?100:8).map(group=>h("button",{key:group.id,className:"dclGroupOption",disabled,"aria-current":group.id===selected?.id?"true":undefined,onClick:()=>{close(true);onSelect(group.id);}},
              h("span",null,group.name,h("small",null,`${group.conversationCount??0} 段对话${group.runningCount?` · ${group.runningCount} 个协作中`:""}`)),group.id===selected?.id?lineIcon("check"):null)),
            query&&!filterConversations(groups,query).length?h("p",{className:"dclAgentMeta",role:"status"},"没有匹配的群组"):null),
          h("button",{className:"dclGroupAdd",disabled,onClick:()=>{close(true);onCreate();}},lineIcon("plus"),"新建群组…"),onManage?h("button",{className:"dclGroupAdd",onClick:()=>{close(true);onManage();}},lineIcon("users"),"全部群組與收存…"):null));
    }

    function CreateGroupDialog({name,onName,source,copyTeam,onCopy,busy,issue,error,onClose,onCreate}) {
      const members=source?.members??[];
      return h("div",{className:"dclModelBackdrop",onKeyDown:event=>{if(event.key==="Escape"){event.stopPropagation();if(!busy)onClose();}}},
        h("form",{className:"dclModelDialog dclCreateDialog",role:"dialog","aria-modal":true,"aria-labelledby":"dcl-create-title","aria-describedby":"dcl-create-description","aria-busy":busy,onSubmit:event=>{event.preventDefault();if(!busy&&name.trim()&&!issue)onCreate();}},
          h("div",{className:"dclCreateHeader"},h("div",{className:"dclCreateMark"},lineIcon("users")),h("div",{className:"dclCreateIntro"},h("h2",{id:"dcl-create-title"},"新建群组"),h("p",{id:"dcl-create-description"},"为另一支团队建立独立的协作空间。")),h("button",{type:"button",className:"dclIconButton",disabled:busy,onClick:onClose,"aria-label":"关闭新建群组"},lineIcon("close"))),
          h("div",{className:"dclCreateFields"},
            h("label",{className:"dclFormField"},h("span",{className:"dclFormLabel"},"群组名称"),h("input",{className:"dclInput","aria-label":"群组名称","data-dcl-initial-focus":true,value:name,onChange:event=>onName(event.target.value),maxLength:120,disabled:busy,placeholder:"例如：研究方法小组",autoComplete:"off","aria-invalid":Boolean(issue),"aria-describedby":issue?"dcl-create-issue":undefined,onKeyDown:event=>{if(event.key==="Enter"&&event.nativeEvent?.isComposing)event.preventDefault();}}),issue?h("span",{id:"dcl-create-issue",className:"dclCreateError",style:{display:"block",marginTop:8},role:"status"},issue):null),
            h("fieldset",{className:"dclCreateChoices",disabled:busy},h("legend",null,"选择创建方式"),
              members.length?h("label",{className:"dclCreateChoice"},h("input",{type:"radio",name:"dcl-group-start",checked:copyTeam,onChange:()=>onCopy(true),"aria-label":"复用当前团队"}),h("span",null,h("strong",null,"复用当前团队"),h("small",null,`${source.groupName??source.name} · ${members.length} 位成员`),h("small",null,"沿用当前对话的模型、职责与章程，使用全新会话。"),copyTeam?h("span",{className:"dclCreateMembers"},members.slice(0,6).map(member=>h("span",{key:member.sessionId,title:member.alias},member.alias)),members.length>6?h("span",null,`另 ${members.length-6} 位`):null):null)):null,
              h("label",{className:"dclCreateChoice"},h("input",{type:"radio",name:"dcl-group-start",checked:!copyTeam,onChange:()=>onCopy(false),"aria-label":"从空白开始"}),h("span",null,h("strong",null,"从空白开始"),h("small",null,"创建后添加成员，逐步组建新的团队。")))),
            h("p",{className:"dclCreateNote"},lineIcon("shield"),h("span",null,`消息、台账和文件授权从空白开始。${copyTeam?"权限从只读审计开始。":"初始为讨论（文件只读）模式。"}创建不会唤醒成员。`)),
            error?h("div",{className:"dclCreateError",role:"alert"},error):null),
          h("div",{className:"dclCreateFooter"},h("button",{type:"button",className:"dclSecondary",disabled:busy,onClick:onClose},"取消"),h("button",{type:"submit",className:"dclPrimary",disabled:busy||!name.trim()||Boolean(issue)},busy?"正在创建…":"创建群组"))));
    }

    function ConversationWelcome({room,members,onParticipants,onCompose}) {
      const hasMembers=members.length>0;
      return h("section",{className:"dclConversationWelcome","aria-label":"对话开始指引"},
        h("div",{className:"dclWelcomeMark"},lineIcon(hasMembers?"chat":"users")),
        h("h3",null,hasMembers?"新的议题，从这里开始":"先为群组添加成员"),
        h("p",null,hasMembers?(room.creation?"团队配置已沿用，消息与台账独立记录。":"团队已就绪，可以开始一段讨论。"):"新建成员可直接选择 DSH 模型，也可以加入已有会话。"),
        hasMembers?h("div",{className:"dclWelcomeMembers"},members.slice(0,6).map(member=>h("button",{key:member.sessionId,className:"dclWelcomeMember",onClick:onParticipants,title:`查看 ${member.alias} 的模型与职责`},h("span",null,member.alias.slice(0,1)),member.alias)),members.length>6?h("button",{className:"dclWelcomeMember",onClick:onParticipants},`另 ${members.length-6} 位`):null):null,
        hasMembers?h("p",null,room.autoDeliver?"直接输入议题，成员会依次参与；也可 @ 指定成员。":"当前仅记录消息；@ 成员或开启自动协作后才会回应。"):
          h("button",{className:"dclPrimary",onClick:onParticipants},"添加成员"),
        hasMembers?h("button",{className:"dclMiniButton dclWelcomeStart",onClick:onCompose},"开始输入",lineIcon("chevron")):null,
        h("p",{className:"dclWelcomeFootnote"},`当前权限：${actionModeLabel(room.policy.defaultActionMode)} · 创建尚未唤醒成员`));
    }

    function statusLabel(state) {
      return ({ unprepared:"首次使用时准备", idle: "空闲", running: "运行中", waking: "唤醒中", offline: "待唤醒", archived: "已归档", missing: "不可用", unknown: "未知" })[state] ?? state;
    }

    const AGENT_ACCENTS = ["#4356b2", "#16736a", "#8a5411", "#704091", "#276587", "#874052"];
    function agentAccent(value) {
      let hash = 0;
      for (const character of String(value ?? "")) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
      return AGENT_ACCENTS[Math.abs(hash) % AGENT_ACCENTS.length];
    }

    function deliveryLabel(delivery) {
      if(delivery.recoveryReason==="restart"&&delivery.status==="failed")return `${delivery.memberAlias??delivery.member}：历史执行已中断，结果待核对`;
      const state = ({ queued: "排队", sent: "已发送", delivered: "已送达", working: "思考中", replied: "已回复", passed: "跳过", failed: "失败", superseded: "已过期" })[delivery.status] ?? delivery.status;
      return `${delivery.memberAlias ?? delivery.member.slice(0, 8)}：${state}`;
    }

    function deliverySummary(deliveries) {
      if (!deliveries?.length) return "";
      const failed = deliveries.filter((item) => item.status === "failed").length;
      const historical=deliveries.filter(item=>item.status==="failed"&&item.recoveryReason==="restart").length;
      const active = deliveries.filter((item) => ["queued", "sent", "delivered", "working"].includes(item.status)).length;
      const replied = deliveries.filter((item) => item.status === "replied").length;
      const passed = deliveries.filter((item) => item.status === "passed").length;
      const superseded = deliveries.filter((item) => item.status === "superseded").length;
      if (failed) return historical===failed?`${historical} 项历史执行待核对`:`${failed} 个失败`;
      if (active) return `${active} 个处理中`;
      if (replied) return `已回复 ${replied}/${deliveries.length}`;
      if (passed === deliveries.length) return "无人补充";
      if (superseded === deliveries.length) return "已被新消息取代";
      return `${deliveries.length} 个投递`;
    }

    function actionModeLabel(mode) {
      return ({ read_only_audit: "只读审计", inherit_dsh: "跟随 DSH", workspace_write: "工作区内修改", full_access: "完全权限" })[mode] ?? "讨论（文件只读）";
    }

    function ledgerKindLabel(kind) {
      return ({ task: "任务", decision: "决定", evidence: "证据", dispute: "分歧" })[kind] ?? kind;
    }

    function ledgerStatusLabel(status) {
      return ({ open: "待处理", in_progress: "进行中", blocked: "受阻", in_review: "待验收", proposed: "待决定", done: "已完成", decided: "已决定", resolved: "已解决", archived: "已归档",cancelled:"已终止",paused:"已暂停" })[status] ?? status;
    }

    function closedLedgerStatus(status) {
      return ["done", "decided", "resolved", "archived", "cancelled", "paused"].includes(status);
    }

    // Every room-local setter carries the render's room generation. This also
    // rejects an old A response after the user has switched A → B → A.
    function useRoomState(scopeRef, initial) {
      const generation=scopeRef.current.generation;
      const [state, update]=React.useState({generation,value:initial});
      return [state.generation===generation?state.value:initial, next=>{
        if(scopeRef.current.generation!==generation)return;
        update(previous=>scopeRef.current.generation!==generation?previous:{generation,value:typeof next==="function"?next(previous.generation===generation?previous.value:initial):next});
      }];
    }

    function ledgerStatusOptions(kind) {
      if (kind === "decision") return ["proposed", "decided", "paused", "cancelled", "archived"];
      if (kind === "task") return ["open", "in_progress", "blocked", "in_review", "done", "paused", "cancelled", "archived"];
      return ["open", "resolved", "paused", "cancelled", "archived"];
    }

    function ledgerOrphanRoles(entry, members) {
      return [["负责人", entry.ownerSessionId], ["验收人", entry.reviewerSessionId]]
        .filter(([, id]) => id && !members.has(id)).map(([label]) => label);
    }

    // BEGIN GENERATED WORK PROTOCOL
    const workProtocol = (function createWorkProtocol() {
  // The ledger's closed-status vocabulary, defined inside the factory rather
  // than at module scope because `scripts/build-client.mjs` stringifies this
  // function into the browser bundle, where a module-level reference would be
  // unresolved. This is the vocabulary's only definition in the repository:
  // the host export below hands the same set to `room-store.js` (ledger
  // lifecycle) and `relationship.js` (unresolved disagreements), so the two can
  // no longer drift apart (R43).
  const closedStatuses = new Set(["done", "decided", "resolved", "archived", "cancelled", "paused"]);
  const closed = status => closedStatuses.has(status);
  const pending = handoff => ["queued", "sending", "waiting_report"].includes(handoff?.state);
  const needsUser = (entry, members) => {
    if (["archived","cancelled","paused"].includes(entry.status)) return false;
    if (["failed", "interrupted", "needs_report", "no_recipient"].includes(entry.handoff?.state)) return true;
    if (closed(entry.status)) return false;
    if ([entry.ownerSessionId, entry.reviewerSessionId].some(id=>id&&!members.has(id))) return true;
    if (entry.kind === "task") return !entry.ownerSessionId || entry.status === "in_review"&&!entry.reviewerSessionId || entry.status === "blocked"&&!pending(entry.handoff);
    return entry.status === "proposed" || entry.kind === "dispute"&&entry.status === "open";
  };
  const related = (entry, entries) => entries.filter(item=>item.id!==entry.id&&(entry.relatedEntryIds?.includes(item.id)||item.relatedEntryIds?.includes(entry.id)||entry.blocker?.entryIds?.includes(item.id)));
  const kindLabel = kind => ({file:"材料读取",decision:"等待决定",permission:"工具权限",dependency:"前置任务",external:"外部条件",other:"待核实原因"})[kind] || "待核实原因";
  const handoffLabel = state => ({queued:"已排队 · 当前讨论结束后通知",sending:"正在提交通知",waiting_report:"已通知 · 等待负责人实测回报",delivered:"已通知 · 不代表任务已完成",reported:"成员已更新台账",needs_report:"本轮结束但未回报处理结果",failed:"通知或执行失败 · 需要处理",interrupted:"通知已中断 · 可核对后重试",no_recipient:"没有有效接手人",cancelled:"事项已变化 · 旧通知已取消"})[state] || "尚未通知";
  const nextAction = entry => entry.kind === "decision" ? "通知关联负责人" : entry.status === "in_review" ? "通知验收人" : entry.status === "blocked" ? "通知负责人实测重试" : "通知负责人开始";
  return {closed,closedStatuses,pending,needsUser,related,kindLabel,handoffLabel,nextAction};
})();
    // END GENERATED WORK PROTOCOL

    function ledgerNeedsUser(entry, members) { return workProtocol.needsUser(entry,members); }

    function ledgerSnapshotText(entry, members) {
      if (!entry) return "此记录没有内容快照。";
      const person = (id) => members.get(id)?.alias ?? (id ? `已离开成员（${id}）` : "未指定");
      return [
        `${ledgerKindLabel(entry.kind)} · ${entry.title ?? "未命名"}`,
        `状态：${ledgerStatusLabel(entry.status)}`,
        entry.details && `详情：${entry.details}`,
        entry.question && `待决问题：${entry.question}`,
        entry.decisionOptions?.length && `备选方案：\n${entry.decisionOptions.map((option) => `${option.label}：${option.description}`).join("\n")}`,
        entry.ownerSessionId && `负责人：${person(entry.ownerSessionId)}`,
        entry.collaboratorSessionIds?.length && `协作人：${entry.collaboratorSessionIds.map(person).join("、")}`,
        entry.kind === "task" && `验收人：${entry.reviewerSessionId ? person(entry.reviewerSessionId) : "由我验收"}`,
        entry.acceptanceCriteria && `验收标准：${entry.acceptanceCriteria}`,
        entry.dueAt && `期限：${new Date(entry.dueAt).toLocaleString()}`,
        entry.acknowledgement?.sessionId && `认领：${person(entry.acknowledgement.sessionId)}`,
        entry.progress?.summary && `进展：${entry.progress.summary}`,
        entry.submission?.summary && `交付说明：${entry.submission.summary}`,
        entry.submission?.deliverable && `交付物：${entry.submission.deliverable}`,
        entry.review?.summary && `处理意见：${entry.review.summary}`,
        entry.review?.selectedOption && `选择方案：${entry.review.selectedOption.label} · ${entry.review.selectedOption.description}`,
        entry.kind === "task" && `提醒监控：${entry.monitor?.enabled ? `停滞 ${entry.monitor.idleMinutes} 分钟提醒 ${person(entry.monitor.coordinatorSessionId)}` : "未开启"}`
      ].filter(Boolean).join("\n");
    }

    function restoredLedgerSnapshot(entry, members) {
      return { ...entry, status: entry.kind === "decision" ? "proposed" : "open",
        ownerSessionId: members.has(entry.ownerSessionId) ? entry.ownerSessionId : undefined,
        reviewerSessionId: members.has(entry.reviewerSessionId) ? entry.reviewerSessionId : undefined,
        collaboratorSessionIds: entry.collaboratorSessionIds?.filter((id) => members.has(id)),
        acknowledgement: undefined, progress: undefined, submission: undefined, review: undefined, monitor: undefined };
    }

    function LedgerSources({ sources, onJump }) {
      if (!Array.isArray(sources) || !sources.length) return null;
      return h("details", { className: "dclLedgerMore" }, h("summary", null, `讨论依据 · ${sources.length}`),
        sources.map((source, index) => {
          const messageId = source.id ?? source.messageId;
          return h("div", { className: "dclLedgerRecord", key: `${messageId ?? "source"}-${index}` },
            h("strong", null, source.authorAlias ?? source.author ?? "公开讨论"),
            h("p", null, source.text ?? source.summary ?? "原消息未附文本快照"),
            messageId ? h("button", { className: "dclMiniButton", onClick: () => onJump(messageId) }, "定位原消息") : null);
        }));
    }

    function confirmationDisabled(busy, target, choice) { return busy || Boolean(target?.kind === "status" && target.status === "decided" && target.entry.decisionOptions?.length && !choice); }

    function DecisionChoices({ entry, choice, onChoice }) {
      const choices = entry.decisionOptions?.length ? entry.decisionOptions : [{ id: "adopt", label: "采纳当前提议", description: "记录为已采纳；不会修改 Host 权限或执行文件操作。" }];
      return h("fieldset", { className: "dclDecisionChoices" }, h("legend", { className: "dclFormLabel" }, "选择处理方式"),
        choices.map((option) => h("label", { key: option.id, className: `dclDecisionOption${choice === option.id ? " selected" : ""}` },
          h("input", { type: "radio", name: "decision-choice", value: option.id, checked: choice === option.id, onChange: () => onChoice(option.id) }),
          h("span", null, h("strong", null, option.label), h("span", { className: "dclDecisionImpact" }, option.description)))));
    }

    function LedgerRelationsEditor({entries,selected,onChange}) {
      return h("details",{className:"dclLedgerMore"},h("summary",null,`关联事项 · 已选 ${selected.length} / 8`),
        h("p",{className:"dclDecisionImpact"},"可关联多项；勾选一项不会覆盖其他关联。关联不自动表示前置依赖，也不表示这些任务已完成。"),
        entries.map(item=>h("label",{key:item.id,className:"dclDecisionOption"},h("input",{type:"checkbox",checked:selected.includes(item.id),disabled:!selected.includes(item.id)&&selected.length>=8,onChange:event=>onChange(event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}),h("span",null,`${ledgerKindLabel(item.kind)} · ${item.title}`))));
    }

    function LedgerTriagePanel({roomId,entry,action,onSaved,onBusy,onCancel}) {
      const [note,setNote]=React.useState(""),[working,setWorking]=React.useState(false),[failure,setFailure]=React.useState("");
      const operation=React.useRef(null);
      const ignoring=action==="dismiss_blocker",archiving=action==="archive";
      const label=action==="show"?"恢复历史显示":action==="resume"?"明确重新开工":ignoring?"确认忽略旧阻断":archiving?"确认移入归档":entry.status==="archived"?entry.kind==="decision"?"恢复为待决定":"恢复为待处理":"撤销忽略";
      const submit=async()=>{
        if(working)return;
        const signature=JSON.stringify({action,note:note.trim()});
        if(!operation.current||operation.current.signature!==signature)operation.current={signature,id:crypto.randomUUID(),revision:entry.revision};
        setWorking(true);onBusy?.(true);setFailure("");
        try{
          const saved=await api(`/rooms/${encodeURIComponent(roomId)}/ledger/${encodeURIComponent(entry.id)}/triage`,{method:"POST",body:JSON.stringify({action,note:note.trim(),operationId:operation.current.id,expectedRevision:operation.current.revision})});
          operation.current=null;
          onSaved(saved,action);
        }catch(error){setFailure(error.message??String(error));}
        finally{setWorking(false);onBusy?.(false);}
      };
      return h(React.Fragment,null,
        h("h3",{className:"dclFormLabel"},entry.title),
        h("p",{className:"dclDecisionImpact"},action==="show"?"只恢复可见性，保留已完成或已终止结果；未完历史保持暂停，不自动重新开工。":action==="resume"?"明确开始新的工作周期，需重新认领与验收。旧成果与记录仍可查，不自动执行。":ignoring?"由你判断这条阻断已过时或不再适用，无需再次申请权限或通过条件检查。它会退出受阻和相应提醒，任务保留为待处理；不会标记完成，也不会自动启动成员。":archiving?"将整个事项移出待办，放入“已归档 / 已移除”。可以恢复，原对话和变更历史保留；不是验收通过，也不自动完成关联任务。":entry.status==="archived"?"恢复到待处理（决定恢复为待决定），需重新认领和验收。旧通知、提醒和完成状态不会自动恢复。":"恢复忽略前的阻断报告，重新列入受阻；旧通知和提醒不会自动恢复。"),
        ignoring?h("p",{className:"dclLedgerHistoryMeta"},"权限已修复、旧报错不再适用时选此项；如果整个任务也不再需要，请选择移除事项。未有新进展前，可从该条目撤销忽略。"):null,
        h("label",{className:"dclFormField"},h("span",{className:"dclFormLabel"},"处理说明（可选）"),h("textarea",{className:"dclFormTextArea","aria-label":"忽略或移除说明",maxLength:2000,value:note,disabled:working,onChange:event=>setNote(event.target.value),placeholder:ignoring?"例如：权限问题已修复，这条历史阻断不再适用。":"可以留空，直接确认。"})),
        h("p",{className:"dclLedgerHistoryMeta"},"取消此事项尚未发出的接手通知及停滞提醒；不停止已经运行的会话，不改变实际权限。"),
        failure?h("p",{className:"dclLedgerWarning",role:"alert"},failure):null,
        h("div",{className:"dclSettingsActions",style:{marginTop:16}},
          h("button",{className:"dclSecondary",disabled:working,onClick:onCancel},"取消"),
          h("button",{className:archiving?"dclDanger":"dclPrimary",disabled:working,onClick:()=>void submit()},working?"保存中…":label)));
    }

    function RecoveryPanel({roomId,entry,related,files,owner,onRead,onJump,onRetry,onOpen,onEdit,onPermissions,onDecisions,onRefresh,onTriage}) {
      const [report,setReport]=React.useState(null),[working,setWorking]=React.useState(false),[localError,setLocalError]=React.useState(""),[notice,setLocalNotice]=React.useState("");
      const [note,setNote]=React.useState(""),[sharePath,setSharePath]=React.useState(""),[shareConfirm,setShareConfirm]=React.useState(false);
      const generation=React.useRef(0),operation=React.useRef(null),shareOperation=React.useRef(null);
      const base=`/rooms/${encodeURIComponent(roomId)}/ledger/${encodeURIComponent(entry.id)}`;
      const check=async()=>{const id=++generation.current;setWorking(true);setLocalError("");try{const value=await api(`${base}/recovery`);if(generation.current===id)setReport(value);}catch(error){if(generation.current===id)setLocalError(error.message??String(error));}finally{if(generation.current===id)setWorking(false);}};
      React.useEffect(()=>{void check();return()=>{generation.current++;};},[roomId,entry.id,entry.revision]);
      const perform=async kind=>{
        const id=++generation.current;setWorking(true);setLocalError("");setLocalNotice("");
        const ref=kind==="share"?shareOperation:operation;
        const signature=JSON.stringify(kind==="share"?{path:sharePath}: {note});
        if(!ref.current||ref.current.signature!==signature)ref.current={signature,id:crypto.randomUUID(),revision:entry.revision};
        try{
          await api(`${base}/${kind==="share"?"share-file":"recovery"}`,{method:"POST",body:JSON.stringify({operationId:ref.current.id,expectedRevision:ref.current.revision,...(kind==="share"?{path:sharePath}:{note})})});
          if(generation.current!==id)return;
          ref.current=null;
          setLocalNotice(kind==="share"?"已只读共享这个文件，没有唤醒成员。请核对检查结果，再选择通知重试。":"接手请求已保存；任务不会仅因通知而改成进行中。可在台账查看通知与回报状态。");
          if(kind==="share"){setSharePath("");setShareConfirm(false);}
          // The mutation acknowledgement is success even if a later refresh fails.
          try{await onRefresh();}catch{setLocalError("操作已保存，但列表刷新失败；请刷新条件检查，不要重复执行。");}
          if(generation.current===id){try{setReport(await api(`${base}/recovery`));}catch{setLocalError("操作已保存，条件复查暂不可用；请刷新检查。");}}
        }catch(error){if(generation.current===id){setLocalError(error.message??String(error));if(/revision conflict/u.test(error.message??""))ref.current=null;}}
        finally{if(generation.current===id)setWorking(false);}
      };
      const pending=workProtocol.pending(entry.handoff);
      const canSend=entry.status!=="blocked"||report?.canRetry;
      return h(React.Fragment,null,
        h("h3",{className:"dclFormLabel"},entry.title),
        h("button",{className:"dclPrimary",disabled:working||pending||!canSend,onClick:()=>void perform("handoff")},pending?"通知已在处理，请等回报":workProtocol.nextAction(entry)),
        h("p",{className:"dclDecisionImpact"},"实际通知指定接手人；讨论运行时排队，不打断它。实测回报后才更新阻断。"),
        onTriage?h("div",{className:"dclLedgerActions"},entry.status==="blocked"?h("button",{className:"dclSecondary",disabled:working,onClick:()=>onTriage(entry,"dismiss_blocker")},"忽略此旧阻断…"):null,h("button",{className:"dclMiniButton",disabled:working,onClick:()=>onTriage(entry,"archive")},"移除事项…")):null,
        entry.status==="blocked"?h("div",{className:"dclLedgerRecord"},h("strong",null,`${workProtocol.kindLabel(entry.blocker?.kind)} · 上次报告 ${new Date(entry.progress?.at??entry.updatedAt).toLocaleString()}`),h("details",null,h("summary",{className:"dclLedgerDetails"},(entry.blocker?.summary||entry.progress?.summary||entry.details||"尚未记录具体原因").slice(0,180)+" · 展开原报告"),h("p",null,entry.blocker?.summary||entry.progress?.summary||entry.details)),entry.blocker?.nextStep?h("p",null,`解除条件 / 下一步：${entry.blocker.nextStep}`):h("p",{className:"dclDecisionImpact"},"旧记录没有结构化解除条件；下面检查当前材料，不把历史报错当成当前结果。")):null,
        entry.handoff?h("div",{className:"dclLedgerRecord",role:"status"},h("strong",null,workProtocol.handoffLabel(entry.handoff.state)),entry.handoff.error?h("p",null,entry.handoff.error):null):null,
        h("div",{className:"dclLedgerActions"},h("strong",null,"当前条件检查"),h("button",{className:"dclSecondary",disabled:working,onClick:()=>void check()},working?"正在检查…":"刷新条件检查")),
        report?h(React.Fragment,null,
          h("p",{className:"dclDecisionImpact"},`检查于 ${new Date(report.checkedAt).toLocaleTimeString()} · 只读检查，不改变状态或权限`),
          report.files.length?report.files.map(file=>h("div",{key:file.path,className:"dclLedgerRecord"},h("strong",null,`${file.status==="readable"?"可读取":"尚不可读"} · ${file.path.split("/").pop()}`),h("p",{className:"dclDecisionImpact",style:{overflowWrap:"anywhere"}},file.path),file.contentHash?h("p",{className:"dclDecisionImpact"},`当前版本 SHA-256 · ${file.contentHash.slice(0,16)}…（请核对所需版本）`):h("p",{className:"dclLedgerWarning"},file.error),h("button",{className:"dclMiniButton",onClick:()=>onRead(file.path)},"只读打开文件"),file.status!=="readable"&&!file.shared?h("button",{className:"dclSecondary",disabled:working,onClick:()=>{setSharePath(file.path);setShareConfirm(true);}},"只读共享此文件…"):null))
            :h("p",{className:"dclDecisionImpact"},"未识别出明确的所需文件；可以补充单个材料路径，或请负责人说明具体条件。"),
          report.unresolvedEntryIds.length?h("p",{className:"dclLedgerWarning"},"已登记的前置事项尚未完成，请先处理下方关联事项。"):null,
          h("p",{className:"dclDecisionImpact"},report.limitation)):null,
        h("details",{className:"dclLedgerMore"},h("summary",null,"补充 / 只读共享材料"),h("label",{className:"dclFormField"},"单个文件的完整路径",h("input",{className:"dclInput","aria-label":"恢复任务的材料路径",value:sharePath,onChange:event=>{setSharePath(event.target.value);setShareConfirm(false);},placeholder:"/Users/…/manuscript.docx"})),h("button",{className:"dclSecondary",disabled:working||!sharePath.trim(),onClick:()=>setShareConfirm(true)},"检查共享范围…")),
        shareConfirm?h("section",{className:"dclLedgerRecord"},h("strong",null,"确认只读共享范围"),h("p",{style:{overflowWrap:"anywhere"}},sharePath),h("p",{className:"dclDecisionImpact"},"仅将这个文件共享给本房间成员，供只读抽取；不会开放父目录、运行命令或自动启动任务。"),h("button",{className:"dclPrimary",disabled:working,onClick:()=>void perform("share")},"确认只读共享"),h("button",{className:"dclSecondary",disabled:working,onClick:()=>setShareConfirm(false)},"取消共享")):null,
        related.length?h("section",{className:"dclLedgerRecord"},h("strong",null,"关联事项 · 决定被采纳不等于后续操作已执行"),related.map(item=>h("button",{key:item.id,className:"dclActionLink",onClick:()=>onJump(item)},`${ledgerStatusLabel(item.status)} · ${item.question||item.title}`)),entry.blocker?.entryIds?.length?h("button",{className:"dclSecondary",onClick:()=>onTriage(entry,"unlink_dependency")},"处理过时前置依赖…"):null):null,
        h("details",{className:"dclLedgerMore"},h("summary",null,"给接手人的补充说明（可选）"),h("textarea",{className:"dclFormTextArea","aria-label":"恢复处理补充说明",value:note,maxLength:2000,onChange:event=>setNote(event.target.value),placeholder:"无需重新复述整个任务，可直接通知。"})),
        !canSend&&!working?h("p",{className:"dclLedgerWarning"},"先解决不可读材料、前置事项或缺失的负责人；不会仅改标签就宣称恢复。"):null,
        h("p",{className:"dclDecisionImpact"},"此按钮会实际通知指定接手人；当前讨论运行时排队，不打断它。实测回报后才更新阻断。重启或手动停止会暂停未完成通知。"),
        h("details",{className:"dclLedgerMore"},h("summary",null,"其他处理方式"),h("div",{className:"dclLedgerActions"},h("button",{className:"dclSecondary",onClick:onPermissions},"调整实际权限 →"),h("button",{className:"dclSecondary",onClick:onEdit},"编辑 / 重新安排"),h("button",{className:"dclSecondary",onClick:()=>onRetry("clarify")},"请负责人补齐条件…"),owner?h("button",{className:"dclSecondary",onClick:onOpen},"打开负责人 DSH 会话"):null)),
        notice?h("p",{className:"dclDecisionImpact",role:"status"},notice):null,localError?h("p",{className:"dclLedgerWarning",role:"alert"},localError):null);
    }

    function ManagementPanel({room,ledger,initial,onClose,onChanged,onBusy}) {
      const [batch,setBatch]=React.useState(initial?.batch??null),[selection,setSelection]=React.useState(initial?.entryIds??[]);
      const [action,setAction]=React.useState(initial?.action??"archive"),[reason,setReason]=React.useState(""),[dependencies,setDependencies]=React.useState("keep");
      const [predecessors,setPredecessors]=React.useState([]);
      const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[confirmStop,setConfirmStop]=React.useState(false);
      const receipt=React.useRef(null),root=React.useRef(null),inFlight=React.useRef(false);
      // The workspace owns initial focus and restoration; focusing here first
      // would make its return target the dialog that is about to be removed.
      const act=async dismiss=>{
        if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError("");
        try{
          if(!batch){
            const payload={action,entryIds:selection,reason:reason.trim()||"整理选定事项",dependencyHandling:action==="unlink_dependency"?"keep":dependencies,...(action==="unlink_dependency"?{predecessorIds:predecessors}:{})};
            const key=JSON.stringify(payload);if(!receipt.current||receipt.current.key!==key)receipt.current={key,id:crypto.randomUUID()};
            setBatch(await api(`/rooms/${encodeURIComponent(room.id)}/management`,{method:"POST",body:JSON.stringify({...payload,operationId:receipt.current.id})}));
          }else setBatch(await api(`/rooms/${encodeURIComponent(room.id)}/management/${encodeURIComponent(batch.id)}`,{method:"POST",body:JSON.stringify({confirmStop,dismiss})}));
          void onChanged().catch(()=>{});
        }catch(cause){setError(cause.message??String(cause));}finally{inFlight.current=false;setBusy(false);onBusy(false);}
      };
      const labels={archive:"归档",terminate:"终止工作",unlink_dependency:"取消过时前置依赖"};
      const running=["queued","running"].includes(room.orchestration?.state),finished=["completed","dismissed"].includes(batch?.state);
      return h("section",{className:"dclModelDialog",ref:root,tabIndex:-1,role:"dialog","aria-modal":true,"aria-label":"整理协作事项"},
        h("div",{className:"dclInspectorHead"},h("strong",null,"整理协作事项"),h("button",{className:"dclClose",disabled:busy,onClick:onClose,"aria-label":"关闭整理窗口"},"×")),
        h("div",{className:"dclModelList"},
          h("p",{className:"dclDecisionImpact"},"按明确清单处理，不标为验收通过。先预览范围，再一次确认；完成后只返回一份处理结果。"),
          !batch?h(React.Fragment,null,
            h("label",{className:"dclFormField"},"处理方式",h("select",{className:"dclSelect",value:action,disabled:busy,onChange:event=>setAction(event.target.value)},Object.entries(labels).map(([value,label])=>h("option",{key:value,value},label)))),
            h("div",{className:"dclLedgerActions"},h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>setSelection(ledger.filter(entry=>!closedLedgerStatus(entry.status)).map(entry=>entry.id))},"选择未闭环事项"),h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>setSelection([])},"清除选择")),
            ledger.map(entry=>h("label",{key:entry.id,className:"dclBatchItem"},h("input",{type:"checkbox",checked:selection.includes(entry.id),disabled:busy,onChange:event=>setSelection(event.target.checked?[...selection,entry.id]:selection.filter(id=>id!==entry.id))}),h("span",null,entry.title,h("small",{className:"dclAgentMeta",style:{display:"block"}},`${ledgerStatusLabel(entry.status)} · ${entry.id.slice(0,8)}`)))),
            action==="unlink_dependency"?h("fieldset",null,h("legend",null,"只取消勾选的前置依赖，其余保留"),[...new Set(ledger.filter(entry=>selection.includes(entry.id)).flatMap(entry=>entry.blocker?.entryIds??[]))].map(id=>h("label",{key:id,className:"dclBatchItem"},h("input",{type:"checkbox",checked:predecessors.includes(id),onChange:event=>setPredecessors(event.target.checked?[...predecessors,id]:predecessors.filter(item=>item!==id))}),ledger.find(entry=>entry.id===id)?.title??id))):h("label",{className:"dclFormField"},"真正依赖这些事项的下游工作",h("select",{className:"dclSelect",value:dependencies,onChange:event=>setDependencies(event.target.value)},h("option",{value:"keep"},"保持不变，在预览中列出影响"),h("option",{value:"unlink"},"取消这些前置依赖，保留其余工作"),h("option",{value:"terminate"},"连同终止受影响的全部下游工作"))),
            h("label",{className:"dclFormField"},"说明（可选）",h("input",{className:"dclInput",value:reason,onChange:event=>setReason(event.target.value),placeholder:"可留空，不必复述全部背景"}))) :h(React.Fragment,null,
            h("p",null,batch.reason),batch.items.map(item=>h("div",{key:item.id,className:"dclBatchItem"},h("span",null,`${labels[item.action]} · ${item.title}`,item.predecessors?.length?h("small",{style:{display:"block"}},"仅取消依赖：",item.predecessors.map(value=>value.title).join("、")):null),h("small",null,`v${item.revision}`))),
            batch.affected?.length&&batch.dependencyHandling==="keep"?h("div",{className:"dclLedgerWarning"},"以下工作仍依赖所选事项；归档不等于满足前置：",batch.affected.map(item=>h("p",{key:item.id},item.title)),h("p",null,"需要改动依赖时，取消本请求，再选择取消依赖或连同终止。")):null,
            batch.results?.length?h("section",{role:"status"},h("strong",null,`${batch.results.filter(item=>item.state==="success").length} 项成功 · ${batch.results.filter(item=>item.state!=="success").length} 项未处理`),batch.results.map(item=>h("p",{key:item.id},`${batch.items.find(target=>target.id===item.id)?.title??item.id}：${item.state==="success"?"已处理":item.error}`))):null,
            running&&!finished?h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:confirmStop,onChange:event=>setConfirmStop(event.target.checked)}),"同意停止当前回合后处理。已经发生的文件修改不会撤销。"):null),
          error?h("p",{className:"dclError",role:"alert"},error):null,
          h("div",{className:"dclSettingsActions"},h("button",{className:"dclSecondary",disabled:busy,onClick:onClose},finished?"关闭":"稍后处理"),
            batch&&!finished&&!batch.results.length?h("button",{className:"dclSecondary",disabled:busy,onClick:()=>void act(true)},"取消此请求"):null,
            !finished?h("button",{className:"dclPrimary",disabled:busy||!batch&&(!selection.length||action==="unlink_dependency"&&!predecessors.length)||Boolean(batch&&running&&!confirmStop),onClick:()=>void act(false)},busy?"处理中…":batch?"确认处理这份清单":"预览处理清单"):null)));
    }

    function LedgerCard({ entry, members, busy, focused, onEdit, onStatus, onSnooze, onJump, onRestore, onBlocked, onTriage }) {
      const orphaned = ledgerOrphanRoles(entry, members);
      const historicalProgress = entry.status !== "blocked" && Math.max(Number(entry.submission?.at)||0,Number(entry.review?.at)||0) > (Number(entry.progress?.at)||0);
      const actorLabel = (id) => id === HUMAN_ID ? "我" : members.get(id)?.alias ?? members.get(String(id ?? "").replace(/^session:/u, ""))?.alias ?? (String(id ?? "").startsWith("session:") ? "已离开成员" : "系统");
      const latestSources = entry.submission?.sources ?? entry.sources;
      return h("article", { id: `dcl-ledger-${entry.id}`, tabIndex: -1, "aria-label": entry.title,
        className: `dclLedgerCard${closedLedgerStatus(entry.status) ? " closed" : ""}${focused ? " focused" : ""}` },
        h("div", { className: "dclLedgerTop" },
          h("span", { className: "dclLedgerKind" }, ledgerKindLabel(entry.kind)),
          h("div", { className: "dclLedgerTitle" }, entry.title)),
        h("div", { className: `dclLedgerStatusBadge${["proposed", "in_review", "blocked"].includes(entry.status) ? " attention" : ""}` },
          entry.status === "done" && entry.review?.verdict === "approve" ? "已验收" : ledgerStatusLabel(entry.status)),
        h("div", { className: "dclLedgerActions" },
          entry.status === "blocked" ? h("button", { className: "dclSecondary", disabled: busy, onClick: () => onBlocked(entry) }, "处理阻断 →") : null,
          onTriage&&entry.status==="blocked"?h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>onTriage(entry,"dismiss_blocker")},"忽略旧阻断…"):null,
          onTriage&&(entry.status==="archived"||entry.triage?.action==="dismiss_blocker")?h("button",{className:"dclSecondary",disabled:busy,onClick:()=>onTriage(entry,entry.status==="archived"?"show":"restore")},entry.status==="archived"?"恢复历史显示…":"撤销忽略…"):null,
          onTriage&&["archived","cancelled","paused"].includes(entry.status)?h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>onTriage(entry,"resume")},"重新开工…"):null,
          entry.status!=="blocked"&&(entry.kind==="task"&&!closedLedgerStatus(entry.status)||entry.kind==="decision"&&entry.status==="decided")?h("button",{className:"dclSecondary",disabled:busy,onClick:()=>onBlocked(entry)},entry.kind==="decision"?"处理决定后续 →":"接手与执行 →"):null,
          entry.kind === "task" && entry.status === "in_review" ? h(React.Fragment, null,
            h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onStatus(entry, "done") }, "验收通过"),
            h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onStatus(entry, "in_progress") }, "退回修改")) : null,
          entry.kind === "decision" && entry.status === "proposed" ? h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onStatus(entry, "decided") }, "查看问题与选项 →") : null,
          orphaned.length ? h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onEdit(entry) }, "重新安排") : null,
          entry.sourceMessageId ? h("button", { className: "dclMiniButton", onClick: () => onJump(entry.sourceMessageId) }, "查看来源") : null,
          onTriage&&entry.status!=="archived"?h("button",{className:"dclMiniButton",disabled:busy,onClick:()=>onTriage(entry,"archive")},"移除事项…"):null),
        entry.details || entry.acceptanceCriteria ? h("details",{className:"dclLedgerMore"},h("summary",null,"任务说明与验收标准"),entry.details?h("div",{className:"dclLedgerDetails"},entry.details):null,entry.acceptanceCriteria?h("div",{className:"dclLedgerDetails"},`验收标准：${entry.acceptanceCriteria}`):null):null,
        h("div", { className: "dclLedgerMeta" },
          entry.ownerSessionId ? h("span", null, `负责人 · ${members.get(entry.ownerSessionId)?.alias ?? "已离开房间"}${entry.acknowledgement?.sessionId === entry.ownerSessionId ? " · 已认领" : entry.kind === "task" && !closedLedgerStatus(entry.status) ? " · 待认领" : ""}`) : null,
          entry.kind === "task" ? h("span", null, `验收 · ${entry.reviewerSessionId ? members.get(entry.reviewerSessionId)?.alias ?? "已离开房间" : "由我确认"}`) : null,
          entry.dueAt ? h("span", null, `期限 · ${new Date(entry.dueAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`) : null),
        orphaned.length ? h("p", { className: "dclLedgerWarning" }, `${orphaned.join("、")}已离开房间。记录仍保留，请重新安排；不会自动转交给其他成员。`) : null,
        entry.status === "done" && !entry.review ? h("p", { className: "dclLedgerHistoryMeta" }, "此条目没有独立验收记录；已完成状态不等于经过验收。") : null,
        entry.blocker?.nextStep&&entry.status==="blocked"?h("p",{className:"dclLedgerWarning"},`下一步：${entry.blocker.nextStep}`):null,
        entry.triage?.action==="dismiss_blocker"?h("p",{className:"dclLedgerHistoryMeta"},"已忽略旧阻断 · 任务待处理，未自动通知；原报告保留在历史中。"):null,
        entry.handoff?h("div",{className:"dclLedgerRecord"},h("strong",null,workProtocol.handoffLabel(entry.handoff.state)),entry.handoff.error?h("p",null,entry.handoff.error):null,entry.handoff.messageId?h("button",{className:"dclMiniButton",onClick:()=>onJump(entry.handoff.messageId)},"查看接手通知"):null):null,
        entry.progress?.summary ? h(historicalProgress?"details":"div", { className: "dclLedgerRecord" }, h(historicalProgress?"summary":"strong", null, `${historicalProgress?"历史进展（交付/验收前）":"最近报告"} · ${actorLabel(entry.progress.actor)} · ${new Date(entry.progress.at).toLocaleDateString()}`),!historicalProgress&&entry.progress.summary.length>200?h("details",null,h("summary",{className:"dclLedgerDetails"},`${entry.progress.summary.slice(0,180)}… 展开全文`),h("p",null,entry.progress.summary)): h("p", null, entry.progress.summary)) : null,
        entry.submission ? h("div", { className: "dclLedgerRecord" }, h("strong", null, `交付记录 · ${actorLabel(entry.submission.actor)}`),
          h("details", null, h("summary",{className:"dclLedgerDetails"},`${entry.submission.summary.slice(0,150)}${entry.submission.summary.length>150?"…":""} · 阅读完整交付`),h("p",null,entry.submission.summary)), entry.submission.deliverable ? h("p", null, `交付物：${entry.submission.deliverable}`) : null,
          entry.status === "in_review" ? h("p", { className: "dclLedgerHistoryMeta" }, "这是成员提交的交付声明，仍需核对材料与验收标准。") : null) : null,
        entry.review ? h("div", { className: "dclLedgerRecord" }, h("strong", null, `处理意见 · ${actorLabel(entry.review.actor)}`), entry.review.selectedOption ? h("p", null, `已选择：${entry.review.selectedOption.label}`) : null, h("p", null, entry.review.summary || entry.review.verdict)) : null,
        h(LedgerSources, { sources: latestSources, onJump }),
        h("details", { className: "dclLedgerMore" }, h("summary", null, "管理与变更历史"),
          h("div", { className: "dclLedgerActions" },
            h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onEdit(entry) }, "编辑条目"),
            h("select", { className: "dclLedgerStatus", value: entry.status, disabled: busy, onChange: (event) => onStatus(entry, event.target.value), "aria-label": `${entry.title} 状态` },
              ledgerStatusOptions(entry.kind).map((status) => h("option", { key: status, value: status }, ledgerStatusLabel(status))))),
          entry.monitor?.enabled && !closedLedgerStatus(entry.status) ? h("div", { className: "dclLedgerMeta" },
            h("span", null, `停滞 ${entry.monitor.idleMinutes} 分钟提醒 ${members.get(entry.monitor.coordinatorSessionId)?.alias ?? "已离开的协调人"}`),
            h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onSnooze(entry, 10) }, "稍后 10 分钟")) : null,
          entry.history?.length ? h("ol", { className: "dclLedgerHistory" }, [...entry.history].reverse().map((event, index) => h("li", { key: `${event.revision ?? "legacy"}-${event.at}-${index}` },
            h("div", { className: "dclLedgerHistoryMeta" }, `${event.revision ? `v${event.revision} · ` : "旧记录 · "}${event.actorAlias ?? actorLabel(event.actor)} · ${new Date(event.at).toLocaleString()}`),
            h("div", { className: "dclLedgerDetails" }, event.summary || `${ledgerStatusLabel(event.fromStatus ?? event.after?.status ?? entry.status)}${event.toStatus && event.fromStatus !== event.toStatus ? ` → ${ledgerStatusLabel(event.toStatus)}` : ""}`),
            h(LedgerSources, { sources: event.sources, onJump }),
            event.after ? h("details", { className: "dclLedgerMore" }, h("summary", null, "查看此版本"), h("pre", { className: "dclLedgerSnapshot" }, ledgerSnapshotText(event.after, members))) : h("div", { className: "dclLedgerHistoryMeta" }, "旧记录未保存内容快照，无法从此条恢复。"),
            event.after && event.revision && event.revision !== entry.revision ? h("button", { className: "dclMiniButton", disabled: busy, onClick: () => onRestore(entry, event) }, "比较并恢复…") : null))) : h("p", { className: "dclLedgerHistoryMeta" }, "暂无历史记录。")));
    }

    function localDateTimeValue(timestamp) {
      if (!(Number(timestamp) > 0)) return "";
      const date = new Date(Number(timestamp));
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }

    function messageDayLabel(timestamp) {
      const date = new Date(timestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (date.toDateString() === today.toDateString()) return "今天";
      if (date.toDateString() === yesterday.toDateString()) return "昨天";
      return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
    }

    function artifactFailureMessage(cause) {
      const detail = cause?.message ?? String(cause);
      const messages = {
        FILE_REFERENCE_AMBIGUOUS: "找到多个同名文件，请按完整路径选择要打开的一份。不会自动猜测版本。",
        FILE_NOT_FOUND: "此路径对应的文件未找到，可能已移动、重命名或删除。请核对原文件位置，并使用当前完整路径。",
        FILE_REFERENCE_UNRESOLVED: "没有找到与此文件名完全对应的工作区文件或已共享文件。请使用目标文件的完整路径；系统不会猜测其他版本。",
        FILE_NOT_AUTHORIZED: "此路径不在当前成员工作区或本房间已共享的单个文件范围内。如需读取，在群聊中贴出这个文件的完整路径即可共享只读访问，无需开放整个目录。",
        FILE_NOT_REGULAR: "此路径不是可预览的普通文件。请提供具体文件路径，而不是目录。",
        FILE_READ_FAILED: "已确认此文件在读取范围内，但本机暂时无法读取。请检查 iCloud 文件是否已下载及 macOS 文件访问设置。"
      };
      if (messages[cause?.code]) return messages[cause.code];
      if (/missing or outside every authorized participant workspace/iu.test(detail)) {
        return "旧版服务未能区分文件路径和读取范围问题。请刷新页面后重试，或使用已共享文件的完整路径。";
      }
      if (/exceeds the .* byte preview limit/iu.test(detail)) return `无法预览：文件超过${detail.includes("20000000") ? " DOCX 20 MB" : "文本 1 MB"} 的安全上限。`;
      if (/unsupported preview type/iu.test(detail)) return "当前可直接读取 DOCX、Markdown、代码和文本；其他格式请在原生 DSH 会话中用合适工具处理。";
      if (/binary files cannot be rendered as text/iu.test(detail)) return "无法预览：该文件是二进制内容。";
      return `无法预览：${detail}`;
    }

    function ArtifactResolutionChoices({preview,onChoose}) {
      return h("section", { className: "dclFileChoices", "aria-label": "选择要打开的同名文件" },
        h("h3", null, "请选择文件"),
        h("p", { role: "status" }, `“${preview.logicalName}”对应多个已获读取权限的路径。请确认目录，系统不会自动选择。`),
        preview.candidates.map(candidate => h("button", { key: `${candidate.sessionId}:${candidate.path}`, className: "dclRowButton dclFileChoice",
          onClick: () => onChoose(candidate.path, { authorKind: "session", author: candidate.sessionId }) },
          h("span", { className: "dclFileChoicePath" }, candidate.path),
          h("span", { className: "dclAgentMeta" }, `${candidate.scope === "human_shared_file" ? "用户已共享 · 单文件只读" : "成员工作区"} · ${candidate.available ? "打开此文件" : "当前不可用 · 点击重新检查"}`)
        ))
      );
    }

    function artifactReferences(text) {
      return textProtocol.fileReferences(text).slice(0,12);
    }

    // Render only text and allowlisted React elements; raw HTML and remote images never execute.
    function markdownInline(text, onFile, depth = 0) {
      if(depth>3)return [text];
      const result=[]; let cursor=0;
      const pattern=/!\[([^\]\n]*)\]\([^\n)]*\)|`([^`\n]+)`|\*\*([^\n]+?)\*\*|\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\n)]+))\)|(?<!\*)\*([^*\n]+)\*(?!\*)/gu;
      for(const match of text.matchAll(pattern)) {
        result.push(text.slice(cursor,match.index)); cursor=match.index+match[0].length;
        const key=match.index;
        if(match[1]!==undefined)result.push(`[图片：${match[1]}，未自动加载]`);
        else if(match[2])result.push(h("code",{key},match[2]));
        else if(match[3])result.push(h("strong",{key},...markdownInline(match[3],onFile,depth+1)));
        else if(match[4]) {
          const target=(match[5]??match[6]).trim();
          const local=textProtocol.fileReferences(`[文件](<${target}>)`).includes(target);
          if(local)result.push(h("button",{key,className:"dclInlineFile",title:target,onClick:()=>onFile?.(target)},match[4]));
          else if(/^https?:\/\//iu.test(target))result.push(h("a",{key,href:target,target:"_blank",rel:"noopener noreferrer"},match[4]));
          else result.push(`${match[4]}（${target}）`);
        } else result.push(h("em",{key},match[7]));
      }
      result.push(text.slice(cursor)); return result;
    }

    function markdownBlocks(text, onFile) {
      const lines=String(text).replace(/\r\n?/gu,"\n").split("\n"), blocks=[];
      const cells=line=>line.trim().replace(/^\||\|$/gu,"").split(/(?<!\\)\|/gu).map(c=>c.trim().replace(/\\\|/gu,"|"));
      for(let i=0;i<lines.length;) {
        const line=lines[i], key=i;
        if(!line.trim()){i++;continue;}
        const fence=line.match(/^\s*(```+|~~~+)\s*(.*)$/u);
        if(fence){const body=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))body.push(lines[i++]);if(i<lines.length)i++;blocks.push(h("pre",{key},h("code",null,body.join("\n"))));continue;}
        const heading=line.match(/^(#{1,6})\s+(.+)$/u);
        if(heading){blocks.push(h(`h${Math.min(4,heading[1].length+1)}`,{key},...markdownInline(heading[2],onFile)));i++;continue;}
        if(/^\s*(?:---+|\*\*\*+)\s*$/u.test(line)){blocks.push(h("hr",{key}));i++;continue;}
        if(line.includes("|")&&lines[i+1]&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/u.test(c))){
          const header=cells(line),rows=[];i+=2;while(i<lines.length&&lines[i].includes("|")&&lines[i].trim())rows.push(cells(lines[i++]));
          blocks.push(h("div",{key,className:"dclTableScroll",tabIndex:0,"aria-label":"表格，可横向滚动"},h("table",null,h("thead",null,h("tr",null,header.map((c,j)=>h("th",{key:j,scope:"col"},...markdownInline(c,onFile))))),h("tbody",null,rows.map((row,r)=>h("tr",{key:r},header.map((_,c)=>h("td",{key:c},...markdownInline(row[c]??"",onFile)))))))));continue;
        }
        const list=line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/u);
        if(list){const items=[],ordered=Boolean(list[2]);while(i<lines.length){const match=lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/u);if(!match||Boolean(match[2])!==ordered)break;items.push(h("li",{key:i},...markdownInline(match[3],onFile)));i++;}blocks.push(h(ordered?"ol":"ul",{key,...(ordered?{start:Number(list[2])}: {})},items));continue;}
        if(/^>\s?/u.test(line)){const quote=[];while(i<lines.length&&/^>/u.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/u,""));blocks.push(h("blockquote",{key},...markdownInline(quote.join("\n"),onFile)));continue;}
        const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*(?:[-*+]\s|\d+[.)]\s|```|~~~)|>)/u.test(lines[i])&&!(lines[i].includes("|")&&lines[i+1]&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/u.test(c))))paragraph.push(lines[i++]);
        blocks.push(h("p",{key},...markdownInline(paragraph.join("\n"),onFile)));
      }
      return blocks;
    }
    function MessageContent({text,onFile}) {
      const [expanded,setExpanded]=React.useState(false);
      const long=text.length>6000;
      return h("div",{className:"dclMarkdown"},...markdownBlocks(long&&!expanded?text.slice(0,1000)+"\n…":text,onFile),long?h("button",{className:"dclExpandText","aria-expanded":expanded,onClick:()=>setExpanded(!expanded)},expanded?"收起长消息":`展开全文 · ${text.length.toLocaleString()} 字符`):null);
    }

    function TextFileReader({preview,onFile}) {
      const [raw,setRaw]=React.useState(false);
      const markdown=/\.(?:md|markdown|mdx)$/iu.test(preview.artifact?.logicalName??preview.logicalName??"");
      return h("section",{"aria-label":"文本文件阅读器"},markdown?h("button",{className:"dclSecondary","aria-pressed":raw,onClick:()=>setRaw(!raw)},raw?"阅读模式":"查看源码"):null,
        markdown&&!raw?h(MessageContent,{text:preview.content??"",onFile}):h("pre",{className:"dclPreview"},preview.content));
    }

    function docxSections(preview) {
      if (preview.document?.version === 1 && Array.isArray(preview.document.sections)) return preview.document.sections;
      // Older backends remain readable while the host is waiting for a safe restart.
      const sections = new Map();
      for (const line of String(preview.content ?? "").split("\n")) {
        const match = line.match(/^\[(word\/[^\]]+?\.xml)\/([^\]]+)\]\s*(.*)$/u);
        const part = match?.[1] ?? "word/document.xml", text = match?.[3] ?? line;
        if (!text.trim()) continue;
        if (!sections.has(part)) sections.set(part,{part,kind:part === "word/document.xml" ? "body" : part.match(/\/([a-z]+)\d*\.xml$/u)?.[1] ?? "other",blocks:[]});
        sections.get(part).blocks.push({type:"paragraph",role:"paragraph",locator:match ? `${part}/${match[2]}` : `${part}/fallback${sections.get(part).blocks.length}`,text,runs:[{text}]});
      }
      return [...sections.values()];
    }

    function docxParagraphs(blocks) {
      return blocks.flatMap(block => block.type === "table" ? block.rows.flatMap(row => row.cells.filter(cell=>!cell.hidden).flatMap(cell=>docxParagraphs(cell.blocks))) : [block]);
    }
    function docxSectionLabel(section) {
      return ({body:"正文",footnotes:"脚注",endnotes:"尾注",comments:"批注",header:"页眉",footer:"页脚"})[section.kind] ?? "其他文本";
    }
    function docxHighlight(text, query) {
      const needle=query.trim().toLocaleLowerCase(); if(!needle)return [text];
      const lower=text.toLocaleLowerCase(), result=[];let start=0,index=lower.indexOf(needle);
      while(index>=0){result.push(text.slice(start,index),h("mark",{key:index},text.slice(index,index+needle.length)));start=index+needle.length;index=lower.indexOf(needle,start);}
      result.push(text.slice(start));return result;
    }
    function renderDocxBlocks(blocks, options) {
      return blocks.filter(block=>!block.hidden).map(block => {
        if(block.type === "table") return h("div",{key:block.locator,className:"dclDocxTable",tabIndex:0,"aria-label":"文档表格，可横向滚动"},
          h("table",null,h("tbody",null,block.rows.map((row,index)=>h("tr",{key:index},row.cells.filter(cell=>!cell.hidden).map((cell,column)=>h(row.header?"th":"td",{key:column,colSpan:cell.colSpan || 1,rowSpan:cell.rowSpan || 1,...(row.header?{scope:"col"}:{})},...renderDocxBlocks(cell.blocks,options))))))));
        const tag=block.role === "title" ? "h2" : block.role === "heading" ? `h${Math.min(6,(block.level || 1)+2)}` : "p";
        const content=(block.runs?.length?block.runs:[{text:block.text}]).map((run,index)=>{
          if(run.noteKind)return h("sup",{key:index},h("button",{className:"dclDocxNoteRef",onClick:()=>options.onNote(run.noteKind,run.noteId,block),"aria-label":`查看${({footnote:"脚注",endnote:"尾注",comment:"批注"})[run.noteKind] ?? "注释"} ${run.noteId}`},run.text));
          let value=docxHighlight(run.text,options.query || "");
          if(run.bold)value=[h("strong",null,...value)];
          if(run.italic)value=[h("em",null,...value)];
          if(run.vertical === "superscript")value=[h("sup",null,...value)];
          if(run.vertical === "subscript")value=[h("sub",null,...value)];
          return h("span",{key:index,...(run.placeholder?{className:"dclDocxPlaceholder"}:{})},...value);
        });
        return h("div",{key:block.locator,id:options.idFor(block.locator),className:`dclDocxBlock${block.locator === options.active ? " isActive" : ""}`},
          block.note ? h("span",{className:"dclDocxNoteLabel"},`${({footnote:"脚注",endnote:"尾注",comment:"批注"})[block.note.kind]} ${block.note.id}`) : null,
          block.note && block.locator === options.active && options.noteOrigin ? h("button",{className:"dclSecondary",onClick:options.onReturnNote},"返回正文引用处") : null,
          options.showLocators ? h("button",{className:"dclDocxLocator",title:block.locator,onClick:()=>options.onLocate(block),"aria-label":`查看定位 ${block.locator}`},`¶ ${block.locator.match(/P(\d+)$/u)?.[1] ?? "定位"}`) : null,
          h(tag,{className:block.role === "title" ? "dclDocxTitle" : undefined,style:["center","right"].includes(block.align)?{textAlign:block.align}:undefined},...content),
          options.citation?.locator === block.locator ? h("div",{className:"dclDocxCitation"},h("strong",null,"段落定位"),h("code",null,block.locator),h("button",{className:"dclSecondary",onClick:options.onCopyCitation},"复制段落引用"),h("button",{className:"dclSecondary",onClick:options.onCloseCitation},"收起定位"),options.notice?h("p",{role:"status"},options.notice):null):null);
      });
    }

    function DocxReader({preview,expanded,onExpand}) {
      const sections=React.useMemo(()=>docxSections(preview),[preview]);
      const [part,setPart]=React.useState(sections[0]?.part ?? "");
      const [mode,setMode]=React.useState("reading");
      const [showLocators,setShowLocators]=React.useState(false);
      const [query,setQuery]=React.useState("");
      const [matchIndex,setMatchIndex]=React.useState(-1);
      const [active,setActive]=React.useState("");
      const [citation,setCitation]=React.useState(null);
      const [noteOrigin,setNoteOrigin]=React.useState(null);
      const [notice,setNotice]=React.useState("");
      const [fontSize,setFontSize]=React.useState(16);
      const prefix=React.useId();
      const idFor=locator=>`${prefix}-docx-${encodeURIComponent(locator)}`;
      const paragraphs=React.useMemo(()=>sections.flatMap(section=>docxParagraphs(section.blocks).map(block=>({...block,part:section.part}))),[sections]);
      const current=sections.find(section=>section.part === part) ?? sections[0];
      const hits=React.useMemo(()=>query.trim()?paragraphs.filter(block=>block.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[],[paragraphs,query]);
      const headings=paragraphs.filter(block=>["heading","title"].includes(block.role));
      const name=preview.artifact?.logicalName ?? preview.logicalName ?? "DOCX 文档";
      const navigate=block=>{if(!block)return;setPart(block.part);setMode("reading");setActive(block.locator);setNotice("");};
      const moveMatch=direction=>{if(!hits.length)return;const index=matchIndex<0?(direction>0?0:hits.length-1):(matchIndex+direction+hits.length)%hits.length;setMatchIndex(index);navigate(hits[index]);};
      const note=(kind,id,origin)=>{const target=paragraphs.find(block=>block.note?.kind===kind&&block.note?.id===id);if(target){setNoteOrigin(paragraphs.find(block=>block.locator===origin.locator));navigate(target);}else setNotice("此注释的正文未包含在当前抽取中，请核对原文件。");};
      React.useEffect(()=>{if(!active||mode!=="reading")return;const frame=requestAnimationFrame(()=>document.getElementById(idFor(active))?.scrollIntoView({block:"center",behavior:"auto"}));return()=>cancelAnimationFrame(frame);},[active,part,mode]);
      const copyCitation=async()=>{try{await navigator.clipboard.writeText(`${name}\n定位：${citation.locator}\nSHA-256：${preview.artifact?.version?.contentHash ?? "未提供"}\n${citation.text}`);setNotice("已复制段落、定位和文件版本。");}catch{setNotice("剪贴板不可用，请选中定位和正文手动复制。");}};
      return h("section",{className:"dclDocxReader","aria-label":"DOCX 阅读器"},
        h("div",{className:"dclDocxFileName"},name),
        h("div",{className:"dclDocxToolbar",role:"group","aria-label":"DOCX 阅读方式"},
          h("button",{className:"dclSecondary","aria-pressed":mode==="reading",onClick:()=>setMode("reading")},"阅读正文"),
          h("button",{className:"dclSecondary","aria-pressed":mode==="source",onClick:()=>setMode("source")},"定位原文"),
          h("button",{className:"dclSecondary","aria-pressed":Boolean(expanded),onClick:onExpand},expanded?"还原侧栏":"展开阅读")),
        h("p",{className:"dclDocxHint"},"只读 · 结构化阅读，不是 Word 原版分页"),
        h("details",{className:"dclDocxLimits"},h("summary",null,"预览说明与限制"),...(preview.extraction?.warnings ?? []).map((warning,index)=>h("p",{key:index},warning))),
        mode === "source" ? h("pre",{className:"dclPreview","aria-label":"带定位码的抽取原文"},preview.content) : h(React.Fragment,null,
          h("div",{className:"dclDocxToolbar"},
            h("select",{className:"dclSelect","aria-label":"文档部分",value:current?.part ?? "",onChange:event=>{setPart(event.target.value);setActive("");setCitation(null);}},sections.map(section=>h("option",{key:section.part,value:section.part},`${docxSectionLabel(section)}${["header","footer"].includes(section.kind)?` ${section.part.match(/\d+/u)?.[0] ?? ""}`:""} · ${docxParagraphs(section.blocks).length} 段`))),
            headings.length?h("select",{className:"dclSelect","aria-label":"跳转文档标题",value:"",onChange:event=>navigate(paragraphs.find(block=>block.locator===event.target.value))},h("option",{value:"",disabled:true},"跳转标题…"),headings.map(block=>h("option",{key:block.locator,value:block.locator},block.text.slice(0,90)))):null,
            h("select",{className:"dclSelect","aria-label":"阅读字号",value:fontSize,onChange:event=>setFontSize(Number(event.target.value))},[14,16,18].map(size=>h("option",{key:size,value:size},`${size} px`)))),
          h("div",{className:"dclDocxSearch"},h("input",{className:"dclInput","aria-label":"查找文档文字",placeholder:"查找文档文字…",value:query,maxLength:160,onChange:event=>{setQuery(event.target.value);setMatchIndex(-1);setActive("");},onKeyDown:event=>{if(event.key==="Enter"&&!event.nativeEvent?.isComposing){event.preventDefault();moveMatch(event.shiftKey?-1:1);}}}),
            query?h("button",{className:"dclSecondary","aria-label":"清除文档查找",onClick:()=>{setQuery("");setMatchIndex(-1);setActive("");}},"×"):null,
            h("button",{className:"dclSecondary",disabled:!hits.length,"aria-label":"上一个匹配段落",onClick:()=>moveMatch(-1)},"↑"),h("button",{className:"dclSecondary",disabled:!hits.length,"aria-label":"下一个匹配段落",onClick:()=>moveMatch(1)},"↓")),
          query.trim()?h("div",{className:"dclDocxHint",role:"status"},hits.length?`${matchIndex>=0?`${matchIndex+1} / `:""}${hits.length} 个匹配段落（含注释）`:"没有匹配的段落"):null,
          h("label",{className:"dclDocxToggle"},h("input",{type:"checkbox",checked:showLocators,onChange:event=>{setShowLocators(event.target.checked);if(!event.target.checked)setCitation(null);}}),"显示段落定位"),
          notice&&!citation?h("p",{className:"dclDocxHint",role:"status"},notice):null,
          h("article",{className:"dclDocxPage","aria-label":`${current?docxSectionLabel(current):"文档"}阅读内容`,style:{fontSize}},
            current?.blocks.length?renderDocxBlocks(current.blocks,{idFor,showLocators,query,active,citation,notice,noteOrigin,onLocate:block=>{setCitation(block);setNotice("");},onCopyCitation:copyCitation,onCloseCitation:()=>{setCitation(null);setNotice("");},onNote:note,onReturnNote:()=>{navigate(noteOrigin);setNoteOrigin(null);}}):h("p",null,"此部分没有可抽取的文字。"))));
    }

    function makeChatBody(ctx) {
      // BEGIN GENERATED WORKSPACE COMPOSER
      const TeamUI = (function createTeamUI(React,h,api,ctx) {
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

  function PersonaEditor({agent,onClose,onSaved}) {
    const [baseline,setBaseline]=React.useState(null),[markdown,setMarkdown]=React.useState("");
    const [loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false),[conflict,setConflict]=React.useState(null);
    const [error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[closing,setClosing]=React.useState(false);
    const alive=React.useRef(true),lock=React.useRef(false),ime=React.useRef(false);
    const path=`/agents/${encodeURIComponent(agent.id)}/persona`,draftKey=`dcl:agent-persona-draft:v1:${agent.id}`;
    const editable=text=>String(text??"").replace(/^<!-- persona:unconfigured -->\r?\n?/u,"");
    const checked=value=>{
      if(value?.agentId!==agent.id||typeof value.markdown!=="string"||typeof value.hash!=="string"||!value.hash)throw new Error("人格回覆缺少正確身分或版本；輸入已保留。");
      return value;
    };
    const cache=(text,base)=>{
      try{localStorage.setItem(draftKey,JSON.stringify({agentId:agent.id,markdown:text,expectedHash:base.hash,baseMarkdown:editable(base.markdown)}));return true;}
      catch{return false;}
    };
    const clearCache=()=>{try{localStorage.removeItem(draftKey);}catch{}};
    const accept=value=>{setBaseline(value);setMarkdown(editable(value.markdown));setConflict(null);clearCache();};
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const load=async()=>{
      if(lock.current)return;lock.current=true;setLoading(true);setError("");
      try{
        const value=checked(await api(path));if(!alive.current)return;
        let draft;try{draft=JSON.parse(localStorage.getItem(draftKey)??"null");}catch{}
        if(draft?.agentId===agent.id&&typeof draft.markdown==="string"&&draft.markdown.length<=8000&&typeof draft.expectedHash==="string"&&draft.expectedHash){
          if(draft.markdown===editable(value.markdown)){accept(value);setNotice("本機草稿與已保存人格相同，已核對。");}
          else{
            setMarkdown(draft.markdown);setBaseline({...value,hash:draft.expectedHash,markdown:draft.baseMarkdown??""});
            if(draft.expectedHash!==value.hash){setConflict(value);setError("人格已在別處修改；本機草稿保留，請先比較。");}
            else setNotice("已恢復未保存的人格草稿。");
          }
        }else accept(value);
      }catch(cause){if(alive.current)setError(`無法讀取人格：${message(cause)}`);}
      finally{lock.current=false;if(alive.current)setLoading(false);}
    };
    React.useEffect(()=>{void load();},[]);
    const dirty=baseline!==null&&markdown!==editable(baseline.markdown);
    const update=text=>{if(lock.current)return;setMarkdown(text);setNotice("");setClosing(false);if(baseline)cache(text,baseline);};
    const close=()=>{
      if(lock.current)return;
      if(dirty&&!cache(markdown,baseline)){setClosing(true);return;}
      onClose();
    };
    const readLatest=async()=>{
      const latest=checked(await api(path));
      if(alive.current){
        if(editable(latest.markdown)===markdown){accept(latest);setError("");setNotice("人格內容已保存，已核對伺服器版本。");}
        else setConflict(latest);
      }
    };
    const refreshConflict=async()=>{
      if(lock.current)return;lock.current=true;setBusy(true);
      try{await readLatest();}catch(cause){if(alive.current)setError(`最新人格仍無法讀取：${message(cause)}。本機草稿保留。`);}
      finally{lock.current=false;if(alive.current)setBusy(false);}
    };
    const save=async event=>{
      event?.preventDefault?.();
      if(lock.current||ime.current||composing(event??{})||!baseline||conflict||!dirty)return;
      lock.current=true;setBusy(true);setError("");setNotice("");cache(markdown,baseline);
      try{
        const value=checked(await api(path,{method:"POST",body:JSON.stringify({markdown,expectedHash:baseline.hash})}));
        if(!alive.current)return;accept(value);setNotice("人格已保存，後續任務使用此版本。");
        try{await onSaved?.(value);}catch{if(alive.current)setNotice("人格已保存；名冊狀態尚待刷新。");}
      }catch(cause){
        if(!alive.current)return;
        if(cause?.status===409){
          setConflict({unavailable:true});setError("人格已在別處修改；你的草稿保留，請比較最新版本後再保存。");
          try{await readLatest();}catch{if(alive.current)setError("人格版本衝突，且最新版本暫時無法讀取。你的草稿保留；請重讀最新人格。");}
        }else setError(`保存未確認：${message(cause)}。草稿保留，可再次保存核對。`);
      }finally{lock.current=false;if(alive.current)setBusy(false);}
    };
    return h(Dialog,{title:`${agent.alias??"Agent"} 的人格`,onClose:close,onEscape:close,busy:loading||busy,focusKey:"persona"},
      h("form",{className:"dclTeamEditor","aria-label":"編輯 Agent 人格",onSubmit:save,onCompositionStart:()=>{ime.current=true;},onCompositionEnd:()=>{ime.current=false;},onKeyDown:event=>{if(composing(event)||ime.current){event.stopPropagation();if(event.key==="Enter")event.preventDefault();}}},
        h("p",{className:"dclAgentMeta"},"人格描述這位 Agent 跨工作維持的性格、偏好與習慣；職務與職責描述工作分工。以 Markdown 編輯。"),
        loading?h("p",{role:"status"},"正在讀取人格…"):baseline?h("p",{className:"dclNotice",role:"status"},baseline.configured?"已設定人格":"尚未設定人格；目前是待填寫模板，修改保存後才啟用。" ):null,
        h("label",{className:"dclFormField"},"人格 Markdown",h("textarea",{className:"dclFormTextArea","aria-label":"Agent 人格 Markdown","data-dcl-initial-focus":true,value:markdown,maxLength:8000,rows:16,disabled:loading||busy||!baseline,onChange:event=>update(event.target.value)})),
        h("p",{className:"dclAgentMeta"},`${markdown.length} / 8000 字元${dirty?" · 有未保存修改":""}`),
        conflict?h("section",{className:"dclNotice","aria-label":"人格版本衝突"},h("h3",null,"人格版本衝突"),h("p",null,"上方保留你的修改。下方是最新已保存版本；比較後選擇如何繼續。"),
          conflict.unavailable?button("重讀最新人格",refreshConflict,{disabled:busy}):h("div",null,
            h("textarea",{className:"dclFormTextArea","aria-label":"最新已保存人格",value:editable(conflict.markdown),readOnly:true,rows:10}),
            button("已比較，保留我的修改",()=>{setBaseline(conflict);setConflict(null);setError("");cache(markdown,conflict);setNotice("已採用最新版本作為保存基準；你的修改仍未保存。");},{disabled:busy}),
            button("採用最新版本，捨棄我的修改",()=>{accept(conflict);setError("");setNotice("已採用最新已保存人格。");},{disabled:busy}))):null,
        error?h("p",{className:"dclError",role:"alert"},error):null,
        !loading&&!baseline?button("重試讀取人格",load,{disabled:busy}):null,
        notice?h("p",{className:"dclNotice",role:"status"},notice):null,
        closing?h("section",{className:"dclNotice"},h("p",null,"本機草稿暫存不可用；離開會失去未保存修改。可返回保存或複製內容。"),button("返回編輯",()=>setClosing(false)),button("放棄修改並關閉",()=>{clearCache();onClose();})):null,
        h("footer",{className:"dclTeamActions"},button("關閉",close,{disabled:loading||busy}),h("button",{type:"submit",className:"dclPrimary",disabled:loading||busy||!dirty||Boolean(conflict)},busy?"保存中…":"保存人格"))));
  }

  function AgentLibrary({onClose,onChanged}={}) {
    const [profiles,setProfiles]=React.useState([]),[loading,setLoading]=React.useState(true),[query,setQuery]=React.useState(""),[archived,setArchived]=React.useState(false),[editing,setEditing]=React.useState(null),[pending,setPending]=React.useState(null),[error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[busy,setBusy]=React.useState(false);
    const pendingKey="dcl:agent-library-pending-save:v1";
    const [pendingSave,setPendingSave]=React.useState(()=>{try{const value=JSON.parse(localStorage.getItem(pendingKey)??"null");return value?.key&&value?.body?.operationId&&typeof value.body.profile?.alias==="string"?value:null;}catch{return null;}});
    const [persona,setPersona]=React.useState(null);
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
      loading?h("p",{role:"status"},"正在讀取 Agent 名冊…"):visible.length?h("div",{className:"dclTeamLibraryList"},visible.map(profile=>h("article",{className:"dclTeamLibraryCard",key:profile.id},h("span",{className:"dclTeamAvatar","aria-hidden":true},(profile.alias??"A").slice(0,1)),h("div",{className:"dclTeamCandidateInfo"},h("strong",null,profile.alias),h("small",null,`${profile.role||"未設定職務"} · ${modelText(profile.model)}`),h("small",null,`${profile.id.slice(0,8)} · 版本 ${profile.revision}${profile.archivedAt?" · 已歸檔":""}${profile.configured===false?" · 開始前待設定":""}`),usageList(profile).length?h("small",null,`使用位置：${usageList(profile).map(item=>item.name??item.title??item.id).join("、")}`):null),h("div",{className:"dclTeamMemberActions"},button("人格",()=>setPersona(profile),{disabled:busy,"aria-label":`編輯 ${profile.alias} 的人格`}),button("編輯",()=>{if(saveReceipt.current)return;setEditing(clone(profile));setError("");},{disabled:busy||Boolean(pendingSave),"aria-label":`編輯 ${profile.alias}`}),button(profile.archivedAt?"恢復":"歸檔",()=>{if(saveReceipt.current)return;setPending(profile);setError("");},{disabled:busy||Boolean(pendingSave),"aria-label":`${profile.archivedAt?"恢復":"歸檔"} ${profile.alias}`}))))):h("div",{className:"dclEmpty"},query?`沒有符合「${query}」的 Agent。`:"尚無 Agent；可在這裡新建，或在組隊時原地建立。"),
      notice?h("p",{className:"dclNotice",role:"status"},notice):null,
      pendingSave&&!editing?h("div",{className:"dclNotice"},"有一筆 Agent 保存結果未確認；關閉編輯器並未撤銷已送出的保存。",button("核對上次保存結果",reconcileSave,{disabled:busy})):null,
      error&&!editing&&!pending?h("div",{className:"dclError",role:"alert"},error,button("重試讀取名冊",()=>void load(),{disabled:busy})):null,
      editing?h(Dialog,{title:editing.id?"編輯 Agent 預設":"新建 Agent",busy,onClose:()=>setEditing(null),focusKey:"agent-editor"},h("div",null,pendingSave?h("div",{className:"dclNotice"},"上次保存結果未確認；改名或改模型前先核對，可避免建立重複 Agent。",button("核對上次保存結果",reconcileSave,{disabled:busy})):null,error?h("p",{className:"dclError",role:"alert"},error):null,notice?h("p",{className:"dclAgentMeta",role:"status"},notice):null,h(AgentEditor,{key:"library-editor",initial:editing,onSave:save,onCancel:()=>setEditing(null),submitLabel:"保存 Agent",scope:"Agent 名冊的未來配置；不自動修改已存在群組或對話"}))):null,
      persona?h(PersonaEditor,{key:persona.id,agent:persona,onClose:()=>setPersona(null),onSaved:()=>setNotice("Agent 人格已保存。") }):null,
      pending?h(Dialog,{title:pending.archivedAt?"恢復 Agent":"歸檔 Agent",busy,onClose:()=>setPending(null),focusKey:"agent-lifecycle"},h("p",null,pending.archivedAt?`恢復「${pending.alias}」到可選名冊？不會重新開始任務。`:`將「${pending.alias}」從常規候選名冊收存？`),h("p",null,`現有群組與對話仍可使用原有配置；不停止任務、不移除群組成員或預選、不刪原生會話或檔案。${usageList(pending).length?` 已知使用位置：${usageList(pending).map(item=>item.name??item.title??item.id).join("、")}。`:""}`),error?h("p",{className:"dclError",role:"alert"},error):null,h("footer",{className:"dclTeamActions"},button("取消",()=>setPending(null),{disabled:busy}),button(busy?"保存中…":pending.archivedAt?"確認恢復":"確認歸檔",lifecycle,{className:"dclPrimary",disabled:busy}))):null);
  }

  return {Dialog,AgentEditor,ParticipantPicker,DirectoryField,PersonaEditor,AgentLibrary};
})(React,h,api,ctx);
      const GroupUI = (function createGroupUI(React,h,api,TeamUI={}) {
  const labelOf=group=>group.name||"未命名群組";
  const localRead=key=>{try{if(typeof localStorage==="undefined")return null;const value=localStorage.getItem(key);return value?JSON.parse(value):null;}catch{return null;}};
  const localWrite=(key,value)=>{try{if(typeof localStorage==="undefined")return false;localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
  const localClear=(key,operationId)=>{try{if(typeof localStorage==="undefined")return false;if(operationId){const value=localRead(key);if((value?.pendingBody??value?.body)?.operationId!==operationId)return false;}localStorage.removeItem(key);return true;}catch{return false;}};
  const actionLabels={archive:"收存",trash:"移至回收區",restore:"恢復群組",pin:"置頂",unpin:"取消置頂"};
  function GroupHome({groups=[],drafts=[],onOpenGroup,onNewGroup,onNewConversation,onDraft,onSettings,onRefresh}) {
    const cacheKey="dcl:group-lifecycle:pending";
    const restored=React.useRef(localRead(cacheKey));
    const saved=restored.current?.schema===1&&restored.current.group?.id===restored.current.groupId&&restored.current.body?.operationId&&actionLabels[restored.current.body.action]?restored.current:null;
    const [query,setQuery]=React.useState(""),[view,setView]=React.useState("recent"),[preview,setPreview]=React.useState(()=>saved?{group:saved.group,action:saved.body.action,activity:saved.activity??{running:[],pending:[],monitors:[]},confirmPause:saved.body.confirmPause===true}:null),[busy,setBusy]=React.useState(false),[issue,setIssue]=React.useState(""),[pending,setPending]=React.useState(Boolean(saved)),[notice,setNotice]=React.useState(saved?"已恢復尚未確認的群組操作；請核對原結果。":""),[changes,setChanges]=React.useState({}),[cacheError,setCacheError]=React.useState("");
    const alive=React.useRef(true),sequence=React.useRef(0),busyRef=React.useRef(false),receipt=React.useRef(saved?{groupId:saved.groupId,body:saved.body}:null);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
    const begin=async(group,action)=>{
      if(busyRef.current||receipt.current)return;busyRef.current=true;setBusy(true);setIssue("");setPreview({group,action});const request=++sequence.current;
      try{
        const current=(await api("/groups")).find(item=>item.id===group.id);
        if(!current)throw new Error("群組已不存在，請重新整理。");
        const activity=["archive","trash"].includes(action)?await api(`/groups/${encodeURIComponent(group.id)}/activity`):{running:[],pending:[],monitors:[]};
        if(!activity||!["running","pending","monitors"].every(key=>Array.isArray(activity[key])))throw new Error("未取得完整活動狀態；不會收存群組，請重新檢查。");
        if(alive.current&&request===sequence.current){const value={group:current,action,activity,confirmPause:false};setPreview(value);if(action==="pin"||action==="unpin")await perform(value,true);}
      }catch(cause){if(alive.current&&request===sequence.current)setIssue(cause.message??String(cause));}
      finally{busyRef.current=false;if(alive.current&&request===sequence.current)setBusy(false);}
    };
    const blocked=Boolean(preview?.activity&&(preview.activity.running.length||preview.activity.pending.length));
    const perform=async(value=preview,prepared=false)=>{
      if(busyRef.current&&!prepared||!value||!receipt.current&&(!value.activity||value.activity.running.length||value.activity.pending.length||value.activity.monitors.length&&!value.confirmPause))return;
      busyRef.current=true;setBusy(true);setIssue("");
      receipt.current??={groupId:value.group.id,body:{action:value.action,expectedRevision:value.group.revision,operationId:crypto.randomUUID(),confirmPause:value.confirmPause===true}};
      const request=receipt.current;
      if(!localWrite(cacheKey,{schema:1,...request,group:value.group,activity:value.activity}))setCacheError("本機未能暫存操作憑據；請留在此頁核對結果，重新載入可能遺失核對入口。");else setCacheError("");
      try{
        const result=await api(`/groups/${encodeURIComponent(request.groupId)}/lifecycle`,{method:"POST",body:JSON.stringify(request.body)});
        const cleared=localClear(cacheKey,request.body.operationId);
        if(alive.current){receipt.current=null;setPending(false);setCacheError(cleared?"":"操作已完成，但本機舊憑據未能清理；再次進入時請核對。");setChanges(old=>({...old,[result.id]:result}));setPreview(null);if(request.body.action==="restore")setView("recent");setNotice(`${actionLabels[request.body.action]}完成：「${labelOf(result)}」。${["archive","trash","restore"].includes(request.body.action)?"歷史保留；不會重啟監測、排程或舊任務。":""}`);try{await onRefresh?.();}catch{if(alive.current)setNotice("操作已保存；列表尚未同步，請重新整理。不要重做此操作。");}}
      }catch(cause){if(alive.current){if(cause.status===400||cause.status===409){localClear(cacheKey,request.body.operationId);receipt.current=null;setPending(false);setPreview(old=>({...old,activity:null,confirmPause:false}));}else setPending(true);setIssue(cause.message??String(cause));}}
      finally{busyRef.current=false;if(alive.current)setBusy(false);}
    };
    const currentGroups=groups.map(group=>{const change=changes[group.id];return change&&change.revision>=(group.revision??0)?{...group,...change,archivedAt:change.archivedAt,deletedAt:change.deletedAt,pinnedAt:change.pinnedAt}:group;});
    const visible=currentGroups.filter(group=>view==="archived"?group.archivedAt&&!group.deletedAt:view==="trash"?group.deletedAt:!group.archivedAt&&!group.deletedAt&&(view!=="pinned"||group.pinnedAt)).filter(group=>labelOf(group).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>Number(Boolean(b.pinnedAt))-Number(Boolean(a.pinnedAt))||(b.lastActivityAt??b.updatedAt??b.createdAt??0)-(a.lastActivityAt??a.updatedAt??a.createdAt??0));
    const groupDrafts=drafts.filter(draft=>draft.kind==="group"&&!draft.discardedAt&&!draft.groupCreatedId&&!draft.startedRoomId);
    const conversationDrafts=drafts.filter(draft=>draft.kind==="conversation"&&!draft.discardedAt&&!draft.groupCreatedId&&!draft.startedRoomId).sort((a,b)=>(b.lastActivityAt??b.updatedAt??b.createdAt??0)-(a.lastActivityAt??a.updatedAt??a.createdAt??0));
    return h("main",{className:"dclGroupHome","aria-label":"群組"},
      h("header",{className:"dclGroupHeader"},h("div",null,h("h2",null,"群組"),h("p",null,"選擇一支團隊，或從空白開始組隊。")),h("div",{className:"dclGroupActions"},h("button",{className:"dclSecondary",onClick:()=>onNewConversation?.()},"臨時對話"),h("button",{className:"dclPrimary",onClick:onNewGroup},"新建群組"))),
      h("p",{className:"dclGroupHint"},"臨時對話不需先建立群組；可以直接開始，再按需要組隊。"),
      notice?h("p",{className:"dclGroupNotice",role:"status"},notice):null,
      cacheError?h("p",{className:"dclGroupError",role:"alert"},cacheError):null,
      h("div",{className:"dclGroupToolbar"},h("input",{className:"dclInput",type:"search",value:query,"aria-label":"搜尋群組",placeholder:"搜尋群組…",onChange:event=>setQuery(event.target.value)}),h("div",{className:"dclGroupFilters","aria-label":"群組篩選"},[["recent","最近"],["pinned","置頂"],["archived","已收存"],["trash","回收區"]].map(([id,name])=>h("button",{className:"dclSecondary",key:id,"aria-pressed":view===id,onClick:()=>setView(id)},name)))),
      h("section",{className:"dclGroupCards","aria-label":"群組清單"},visible.length?visible.map(group=>h("article",{className:"dclGroupCard",key:group.id},h("button",{className:"dclGroupOpen","aria-label":`開啟群組：${labelOf(group)}`,onClick:()=>onOpenGroup?.(group.id)},h("strong",null,labelOf(group)),h("span",null,group.conversationCount?`${group.conversationCount} 段對話`:"尚無對話"),group.runningCount?h("span",{className:"dclGroupRunning"},`${group.runningCount} 段協作中`):null),!group.archivedAt&&!group.deletedAt?h("button",{className:"dclSecondary","aria-label":`管理群組：${labelOf(group)}`,onClick:()=>onSettings?.(group)},"管理"):null,
        !group.archivedAt&&!group.deletedAt?h("button",{className:"dclSecondary",disabled:busy||pending,"aria-label":`${group.pinnedAt?"取消置頂":"置頂"}群組：${labelOf(group)}`,onClick:()=>void begin(group,group.pinnedAt?"unpin":"pin")},group.pinnedAt?"已置頂":"置頂"):null,
        h("details",{className:"dclGroupCardMore"},h("summary",null,"更多"),!group.archivedAt&&!group.deletedAt?h("button",{className:"dclSecondary",disabled:busy||pending,"aria-label":`收存群組：${labelOf(group)}`,onClick:()=>void begin(group,"archive")},"收存"):null,(group.archivedAt||group.deletedAt)?h("button",{className:"dclSecondary",disabled:busy||pending,"aria-label":`恢復群組：${labelOf(group)}`,onClick:()=>void begin(group,"restore")},"恢復群組"):null,!group.deletedAt?h("button",{className:"dclDanger",disabled:busy||pending,"aria-label":`移至回收區：${labelOf(group)}`,onClick:()=>void begin(group,"trash")},"移至回收區"):null))):h("p",{className:"dclGroupEmpty",role:"status"},query?"沒有符合搜尋的群組。":"這裡尚無群組。")),
      preview?h("section",{className:"dclGroupLifecycle","aria-label":"群組收存預覽"},h("h3",null,`${actionLabels[preview.action]}「${labelOf(preview.group)}」`),h("p",null,preview.action==="restore"?"恢復群組的顯示與可操作狀態；不會重啟監測、排程或舊任務。":preview.action==="trash"?"移至可恢復的群組回收區，不再新增派送；不刪文件或原生會話，也不刪其他群組的 Agent。":preview.action==="archive"?"從日常清單收存，不刪對話、Agent、原生會話或文件；之後可以恢復。":"只調整群組在清單的位置，不影響對話與執行。"),busy?h("p",{role:"status"},receipt.current?"正在保存操作…":"正在核對群組活動…"):null,issue?h("p",{className:"dclGroupError",role:"alert"},issue):null,blocked?h("div",{className:"dclGroupError",role:"alert"},"仍有執行或待派送工作；請先查看相關對話，完成後再整理。收存不會暗中停止工作。",[...preview.activity.running,...preview.activity.pending].map(item=>h("button",{className:"dclSecondary",key:item.id,"aria-label":`查看對話：${item.name??item.title}`,onClick:()=>onOpenGroup?.(preview.group.id,item.roomId??item.id)},`查看 ${item.name??item.title}`))):null,
        preview.activity?.monitors.length?h("div",{className:"dclGroupMonitors"},h("p",null,`另有 ${preview.activity.monitors.length} 項未來監測；收存時必須一併暫停。`),h("ul",null,preview.activity.monitors.map(item=>h("li",{key:`${item.roomId}:${item.id}`},item.title||"未命名監測"))),h("label",{className:"dclGroupCheck"},h("input",{type:"checkbox","aria-label":"確認暫停此群組的未來監測",checked:preview.confirmPause,disabled:busy||pending,onChange:event=>setPreview(old=>({...old,confirmPause:event.target.checked}))}),"確認暫停此群組的未來監測；恢復群組不會重啟。")):null,
        pending?h("div",{className:"dclGroupNotice",role:"status"},h("p",null,"操作結果尚未確認；先核對這次操作，保留原憑據，不重複提交不同內容。"),h("button",{className:"dclSecondary",disabled:busy,onClick:()=>void perform()},"核對並重試這次操作")):null,
        h("div",{className:"dclGroupActions"},h("button",{className:"dclSecondary",disabled:busy||pending,onClick:()=>setPreview(null)},"取消"),h("button",{className:"dclSecondary",disabled:busy||pending,onClick:()=>void begin(preview.group,preview.action)},"重新檢查"),h("button",{className:"dclPrimary",disabled:busy||pending||blocked||!preview.activity||Boolean(preview.activity.monitors.length&&!preview.confirmPause),onClick:()=>void perform()},`確認${actionLabels[preview.action]}`))):null,
      groupDrafts.length?h("section",{className:"dclGroupDrafts","aria-label":"群組草稿"},h("h3",null,"群組草稿"),groupDrafts.map(draft=>h("button",{className:"dclGroupDraft",key:draft.id,onClick:()=>onDraft?.(draft)},draft.title||"未命名群組草稿"))):null,
      conversationDrafts.length?h("details",{className:"dclGroupSection dclGroupConversationDrafts","aria-label":"對話草稿"},h("summary",null,`對話草稿 · ${conversationDrafts.length}`),h("p",{className:"dclGroupHint"},"尚未完成的對話保留在這裡；繼續草稿不會另建群組。"),conversationDrafts.map(draft=>{
        const text=String(draft.text??"").trim().replace(/\s+/gu," "),excerpt=text.length>100?`${text.slice(0,100)}…`:text;
        const title=String(draft.title??"").trim()||excerpt||"未命名對話草稿";
        const owner=draft.groupId?(groups.find(group=>group.id===draft.groupId)?.name??"原群組暫不可用"):"臨時對話";
        return h("button",{className:"dclGroupDraft dclGroupConversationDraft",key:draft.id,"aria-label":`${draft.start?"核對開始結果":"繼續對話草稿"}：${title}`,onClick:()=>onDraft?.(draft)},h("span",{className:"dclGroupDraftInfo"},h("strong",null,title),h("small",null,`${owner}${draft.start?" · 開始結果待核對":""}`),draft.title&&excerpt?h("span",{className:"dclGroupDraftExcerpt"},excerpt):null));
      })):null);
  }
  const modes={discuss_only:"只討論",read_only_audit:"只讀審閱",inherit_dsh:"遵循 DSH",workspace_write:"工作區修改",full_access:"完整權限"};
  const memberId=member=>member.id??member.membershipId??member.agentId;
  const settingsOf=(group,config=group.defaults??{})=>({name:group.name??"",members:structuredClone(config.members??[]),defaultParticipantIds:[...(config.defaultParticipantIds??[])],environment:structuredClone(config.environment??{cwd:"",overrides:{}}),charter:config.charter??"",autoDeliver:config.autoDeliver!==false,mode:config.mode??config.defaultActionMode??"inherit_dsh"});
  function GroupSettings({group,onClose,onSaved,TeamUI:customTeamUI}) {
    const team=customTeamUI??TeamUI;
    const [data,setData]=React.useState(null),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(""),[status,setStatus]=React.useState(""),[picker,setPicker]=React.useState(false),[pending,setPending]=React.useState(false),[conflict,setConflict]=React.useState(false),[latest,setLatest]=React.useState(null),[leaving,setLeaving]=React.useState(false),[cacheError,setCacheError]=React.useState("");
    const revision=React.useRef(group.revision),base=React.useRef(null),alive=React.useRef(true),busyRef=React.useRef(false),receipt=React.useRef(null),loadSequence=React.useRef(0),target=React.useRef(group.id),dataRef=React.useRef(null),restored=React.useRef(null);
    const storageKey=`dcl:group-settings:${group.id}`;
    target.current=group.id;
    const adopt=value=>{dataRef.current=value;setData(value);};
    const cache=(value=dataRef.current)=>{if(!value)return true;const ok=localWrite(storageKey,{schema:1,groupId:group.id,data:value,inputRevision:revision.current,base:base.current,pendingBody:receipt.current});setCacheError(ok?"":"本機暫存不可用；輸入尚在此頁，離開或重新載入可能遺失。請先保存或複製內容。");return ok;};
    const load=async(compare=false)=>{
      const sequence=++loadSequence.current;setLoading(true);setError("");
      try{
        const before=(await api("/groups")).find(item=>item.id===group.id);
        if(!before)throw new Error("群組已不存在；未修改任何設定。");
        const config=await api(`/groups/${encodeURIComponent(group.id)}/configuration?all=true`);
        const after=(await api("/groups")).find(item=>item.id===group.id);
        if(!after||before.revision!==after.revision)throw new Error("讀取時群組已更新，請重新載入。");
        if(alive.current&&sequence===loadSequence.current){const value=settingsOf(after,config);if(compare)setLatest({data:value,revision:after.revision});else if(restored.current){if(!receipt.current&&revision.current!==after.revision){setConflict(true);setLatest({data:value,revision:after.revision});setStatus("已恢復本機未保存修改；服務端有新版本，請比較。");}else setStatus(receipt.current?"已恢復待核對的保存；使用原憑據核對，不另建成員。":"已恢復本機未保存修改；尚未套用至群組。");}else{revision.current=after.revision;base.current=JSON.stringify(value);adopt(value);}}
      }catch(cause){if(alive.current&&sequence===loadSequence.current)setError(cause.message??String(cause));}
      finally{if(alive.current&&sequence===loadSequence.current)setLoading(false);}
    };
    React.useEffect(()=>{
      alive.current=true;busyRef.current=false;receipt.current=null;base.current=null;restored.current=null;adopt(null);setBusy(false);setPending(false);setConflict(false);setLatest(null);setPicker(false);setLeaving(false);setStatus("");setCacheError("");
      const saved=localRead(storageKey);
      if(saved?.schema===1&&saved.groupId===group.id&&saved.data&&Array.isArray(saved.data.members)&&Array.isArray(saved.data.defaultParticipantIds)&&Number.isFinite(saved.inputRevision)){
        restored.current=saved;revision.current=saved.inputRevision;base.current=saved.base??null;adopt(saved.data);receipt.current=saved.pendingBody??null;setPending(Boolean(receipt.current));
      }
      void load();return()=>{alive.current=false;loadSequence.current++;};
    },[group.id]);
    const update=patch=>{if(busyRef.current||receipt.current)return;const next={...dataRef.current,...patch};adopt(next);setStatus(cache(next)?"尚未保存 · 已暫存在本機":"尚未保存 · 本機暫存失敗");};
    const useMembers=input=>{const members=input.filter(member=>member.enabled!==false),ids=new Set(members.map(memberId));update({members,defaultParticipantIds:data.defaultParticipantIds.filter(id=>ids.has(id)),environment:{...data.environment,overrides:Object.fromEntries(Object.entries(data.environment.overrides??{}).filter(([id])=>ids.has(id))),...(data.environment.presetOverrides?{presetOverrides:Object.fromEntries(Object.entries(data.environment.presetOverrides).filter(([id])=>ids.has(id)))}:{})}});};
    const save=async()=>{
      if(busyRef.current||!data||loading||conflict)return;busyRef.current=true;setBusy(true);setError("");
      receipt.current??={...structuredClone(data),expectedRevision:revision.current,operationId:crypto.randomUUID()};
      cache();
      const body=receipt.current,savingGroupId=group.id,generation=loadSequence.current,current=()=>alive.current&&target.current===savingGroupId&&loadSequence.current===generation;
      try{const result=await api(`/groups/${encodeURIComponent(savingGroupId)}`,{method:"POST",body:JSON.stringify(body)});const cleared=localClear(storageKey,body.operationId);if(current()){receipt.current=null;restored.current=null;setPending(false);const value=settingsOf(result,{...body,...result.defaults});revision.current=result.revision;base.current=JSON.stringify(value);adopt(value);setCacheError(cleared?"":"設定已保存，但本機舊暫存未能清理；重新進入時請核對版本。");setStatus("已保存；只影響未來對話，不改既有對話，也未發送消息。");try{await onSaved?.(result);}catch{if(current())setStatus("群組設定已保存；列表尚未同步，請重新整理。");}}}
      catch(cause){if(current()){if(cause.status===400||cause.status===409){receipt.current=null;setPending(false);cache();}else setPending(true);if(cause.status===409){setConflict(true);setLatest(null);}setError(cause.message??String(cause));}}
      finally{if(current()){busyRef.current=false;setBusy(false);}}
    };
    const finishComparison=useMine=>{revision.current=latest.revision;base.current=JSON.stringify(latest.data);restored.current=null;if(!useMine){adopt(latest.data);if(!localClear(storageKey))setCacheError("已採用最新版本，但本機舊暫存未能清理；再次進入時請核對。");}else cache();setLatest(null);setConflict(false);setError("");setStatus(useMine?"已保留本機版本；按保存才會套用已比較的差異。":"已採用最新版本；沒有提交修改。");};
    const describe=(value,key)=>key==="members"?value.members.map(member=>[member.alias,member.role,member.model?.model].filter(Boolean).join(" · ")).join("；")||"無成員":key==="defaultParticipantIds"?value.defaultParticipantIds.map(id=>value.members.find(member=>memberId(member)===id)?.alias??id).join("、")||"無預選":key==="environment"?[value.environment.cwd||"未指定",...Object.entries(value.environment.overrides??{}).map(([id,path])=>`${value.members.find(member=>memberId(member)===id)?.alias??id}：${path}`),value.environment.agentPreset?`原生配置：${value.environment.agentPreset}`:null,...Object.entries(value.environment.presetOverrides??{}).map(([id,preset])=>`${id} 配置：${preset}`)].filter(Boolean).join("；"):key==="autoDeliver"?value.autoDeliver?"開啟":"關閉":key==="mode"?modes[value.mode]??value.mode:value[key]||"（空白）";
    return h("section",{className:"dclGroupSettings","aria-label":`群組設定：${labelOf(group)}`,"aria-busy":busy||loading},
      h("header",{className:"dclGroupHeader"},h("div",null,h("h2",null,"群組設定"),h("p",null,"成員池與預選只影響未來對話；不改既有對話，不發送消息。")),h("button",{className:"dclSecondary",disabled:busy,onClick:()=>data&&(pending||JSON.stringify(data)!==base.current)?setLeaving(true):onClose?.()},"返回")),
      loading?h("p",{role:"status",className:"dclGroupEmpty"},"正在讀取群組設定…"):null,
      error?h("div",{className:"dclGroupError",role:"alert"},error,!data?h("button",{className:"dclSecondary",disabled:loading,onClick:()=>void load()},"重新載入設定"):null):null,
      cacheError?h("p",{className:"dclGroupError",role:"alert"},cacheError):null,
      pending?h("div",{className:"dclGroupNotice",role:"status"},h("p",null,"保存結果尚未確認；輸入保持不變，請先核對這次保存，不會另建重複成員。"),h("button",{className:"dclSecondary",disabled:busy,onClick:()=>void save()},"核對並重試這次保存")):null,
      conflict?h("section",{className:"dclGroupConflict","aria-label":"群組設定版本衝突"},h("h3",null,"群組在別處更新；你的輸入仍保留"),h("button",{className:"dclSecondary",disabled:loading,onClick:()=>void load(true)},"讀取最新版本並比較"),latest?h(React.Fragment,null,h("div",{className:"dclGroupComparison"},h("table",null,h("thead",null,h("tr",null,h("th",null,"設定"),h("th",null,"我的未保存修改"),h("th",null,"最新版本"))),h("tbody",null,[["name","名稱"],["members","成員池"],["defaultParticipantIds","新對話預選"],["environment","工作環境"],["charter","共同約定"],["autoDeliver","自動協作"],["mode","權限偏好"]].filter(([key])=>JSON.stringify(data[key])!==JSON.stringify(latest.data[key])).map(([key,label])=>h("tr",{key},h("th",{scope:"row"},label),h("td",null,describe(data,key)),h("td",null,describe(latest.data,key))))))),h("button",{className:"dclSecondary",onClick:()=>finishComparison(false)},"採用最新版本，捨棄我的未保存修改"),h("button",{className:"dclSecondary",onClick:()=>finishComparison(true)},"保留我的設定，以上差異採用本機版本")):null):null,
      leaving?h("section",{className:"dclGroupNotice","aria-label":"確認離開群組設定"},h("p",null,pending?"保存結果仍待核對。可保留原憑據與輸入，下次進入繼續核對；不會取消已送出的保存。":"還有未保存的設定。可以保留到本機，之後回來繼續，或明確捨棄。"),h("button",{className:"dclSecondary",onClick:()=>setLeaving(false)},"繼續編輯"),h("button",{className:"dclSecondary",onClick:()=>{if(cache())onClose?.();}},"保留修改並返回"),!pending?h("button",{className:"dclDanger",onClick:()=>{if(localClear(storageKey))onClose?.();else setCacheError("未能清除本機暫存，尚未捨棄；請先繼續編輯或保存。");}},"返回並捨棄未保存修改"):null):null,
      data?h("fieldset",{className:"dclGroupForm",disabled:busy||pending},
        h("label",{className:"dclGroupField"},"群組名稱",h("input",{className:"dclInput","aria-label":"群組名稱",value:data.name,maxLength:120,disabled:busy,onChange:event=>update({name:event.target.value})})),
        h("section",{className:"dclGroupMembers","aria-label":"群組成員池"},h("div",{className:"dclGroupSectionHeader"},h("h3",null,`群組成員 · ${data.members.length}`),h("button",{className:"dclSecondary",disabled:busy||!team.ParticipantPicker,onClick:()=>setPicker(true)},"加入或調整成員")),h("p",null,"加入群組不會自動設為新對話預選；移出不影響既有對話。"),data.members.length?data.members.map(member=>h("article",{key:memberId(member),className:"dclGroupMember"},h("span",{className:"dclGroupAvatar","aria-hidden":true},(member.alias||"A").slice(0,1)),h("div",null,h("strong",null,member.alias||"未命名 Agent"),h("p",null,member.role||"尚未設定職務")),h("button",{className:"dclSecondary",disabled:busy,"aria-label":`移出群組：${member.alias}`,onClick:()=>useMembers(data.members.filter(item=>memberId(item)!==memberId(member)))},"移出"))):h("p",{className:"dclGroupEmpty"},"尚無成員。可以先保存空群組，之後再加入 Agent。")),
        h("section",{className:"dclGroupPreselection","aria-label":"新對話預選"},h("h3",null,`新對話預選 · ${data.defaultParticipantIds.length} 位`),h("p",null,"預選可以少於成員池；未勾選的人仍是群組成員。"),data.members.map(member=>h("label",{key:memberId(member),className:"dclGroupCheck"},h("input",{type:"checkbox","aria-label":`預選${member.alias}`,checked:data.defaultParticipantIds.includes(memberId(member)),disabled:busy,onChange:event=>update({defaultParticipantIds:event.target.checked?[...new Set([...data.defaultParticipantIds,memberId(member)])]:data.defaultParticipantIds.filter(id=>id!==memberId(member))})}),member.alias)),!data.defaultParticipantIds.length?h("p",{className:"dclGroupHint"},"新對話預設為零人；可先記筆記，再選擇參與者。"):null),
        h("details",{className:"dclGroupSection"},h("summary",null,"共同約定"),h("label",{className:"dclGroupField"},"供未來對話使用的共同約定",h("textarea",{className:"dclFormTextArea","aria-label":"群組共同約定",value:data.charter,disabled:busy,maxLength:20000,onChange:event=>update({charter:event.target.value})}))),
        h("details",{className:"dclGroupSection"},h("summary",null,"工作環境"),team.DirectoryField?h(team.DirectoryField,{label:"群組預設工作目錄",value:data.environment.cwd??"",disabled:busy||pending,onChange:value=>update({environment:{...data.environment,cwd:value}})}):h("label",{className:"dclGroupField"},"群組預設工作目錄",h("input",{className:"dclInput","aria-label":"群組預設工作目錄",value:data.environment.cwd??"",disabled:busy,placeholder:"貼上完整路徑（選擇器暫不可用）",onChange:event=>update({environment:{...data.environment,cwd:event.target.value}})})),Object.keys(data.environment.overrides??{}).length?h("div",{className:"dclGroupOverrides"},h("p",null,"下列成員另有工作目錄；只改群組目錄不會覆寫這些設定。"),h("ul",null,Object.entries(data.environment.overrides).map(([id,path])=>h("li",{key:id},`${data.members.find(member=>memberId(member)===id)?.alias??id}：${path}`))),h("button",{className:"dclSecondary",disabled:busy,onClick:()=>update({environment:{...data.environment,overrides:{}}})},"全部成員改用群組目錄")):null,h("p",{className:"dclGroupHint"},"保存目錄只是設定工作位置，不額外授予文件權限。")),
        h("details",{className:"dclGroupSection"},h("summary",null,`協作與權限 · ${modes[data.mode]??data.mode}`),h("label",{className:"dclGroupCheck"},h("input",{type:"checkbox","aria-label":"新對話預設自動協作",checked:data.autoDeliver,disabled:busy,onChange:event=>update({autoDeliver:event.target.checked})}),"新對話預設自動協作"),h("label",{className:"dclGroupField"},"未來對話的權限偏好",h("select",{className:"dclSelect","aria-label":"群組預設權限",value:data.mode,disabled:busy,onChange:event=>update({mode:event.target.value})},Object.entries(modes).map(([value,label])=>h("option",{value,key:value},label)))),h("p",{className:"dclGroupHint"},"这里只保存偏好；不修改現有原生會話。開始工作前仍核對實際範圍。")),
        h("footer",{className:"dclGroupActions"},h("span",{role:"status"},status),h("button",{className:"dclPrimary",disabled:busy||pending||conflict||!data.name.trim()||JSON.stringify(data)===base.current,onClick:()=>void save()},busy?"保存中…":"保存群組設定")),
        picker&&team.ParticipantPicker?h(team.ParticipantPicker,{members:data.members,groupMembers:data.members,target:{kind:"group-members",id:group.id},onClose:()=>setPicker(false),onApply:members=>{useMembers(members);setPicker(false);}}):null):null);
  }
  return {GroupHome,GroupSettings};
})(React,h,api,TeamUI);
      const WorkspaceComposer = (function createWorkspaceComposer(React,h,api,ctx,TeamUI={}) {
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
})(React,h,api,ctx,TeamUI);
      // END GENERATED WORKSPACE COMPOSER
      const sessionsSnapshot = () => {
        try { return ctx.sessions?.list?.getSnapshot?.() ?? null; } catch { return null; }
      };

      class ModelBoundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        render() {
          return this.state.failed
            ? h("div", { className: "dclAgentMeta" }, "此会话当前不可配置模型；可打开会话检查状态。")
            : this.props.children;
        }
      }

      function ParticipantModel({ sessionId, roomId, sharedNative=false, sharedWith=[] }) {
        const directory = React.useMemo(() => ctx.modelDirectories.directoryFor(sessionId), [sessionId]);
        const available = ctx.sessions.subagentAddress?.(sessionId) === undefined;
        const state = React.useSyncExternalStore(
          React.useCallback((listener) => directory.store.subscribe(listener), [directory]),
          React.useCallback(() => directory.store.getSnapshot(), [directory]),
          React.useCallback(() => directory.store.getSnapshot(), [directory])
        );
        const [open, setOpen] = React.useState(false);
        const [localError, setLocalError] = React.useState("");
        const [localBusy,setLocalBusy]=React.useState(false);
        const [confirmShared,setConfirmShared]=React.useState(false);
        const triggerRef = React.useRef(null);
        const dialogRef = React.useRef(null);
        const choices = state.groups.flatMap((group) => group.models.map((model) => ({ group, model })));
        const currentChoice = choices.find(({ group, model }) => group.id === state.current?.provider && model.id === state.current?.model);
        const currentModel = currentChoice?.model?.name ?? (state.current ? `${state.current.provider}/${state.current.model}` : "选择模型");
        const currentReasoning = currentChoice?.model?.reasoning;
        const effectiveEffort = state.current?.reasoningEffort ?? currentReasoning?.defaultEffort;
        const busy = localBusy || state.status === "loading" || state.status === "selecting";

        React.useEffect(() => {
          if (open) queueMicrotask(() => dialogRef.current?.focus());
        }, [open]);

        const show = async () => {
          setOpen(true);
          setConfirmShared(false);
          setLocalError("");
          try { await directory.load(); }
          catch (cause) { setLocalError(cause.message ?? String(cause)); }
        };
        const close = () => {
          setOpen(false);
          queueMicrotask(() => triggerRef.current?.focus());
        };
        const selectModel = async (group, model) => {
          setLocalError("");
          setLocalBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(sessionId)}/model`,{method:"POST",body:JSON.stringify({
              provider: group.id,
              confirmShared,
              model: model.id,
              ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort })
            })});
            await directory.load();
            close();
          } catch (cause) { setLocalError(cause.message ?? String(cause)); }finally{setLocalBusy(false);}
        };
        const selectEffort = async (effort) => {
          if (!state.current) return;
          if(sharedNative&&!confirmShared){void show();setLocalError("这是共享的原生会话，请先在模型窗口确认影响范围，再调整模型或推理强度。");return;}
          setLocalError("");
          setLocalBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(sessionId)}/model`,{method:"POST",body:JSON.stringify({
              provider: state.current.provider,
              confirmShared,
              model: state.current.model,
              ...(effort === "" ? {} : { reasoningEffort: effort })
            })});
            await directory.load();
          } catch (cause) { setLocalError(cause.message ?? String(cause)); }finally{setLocalBusy(false);}
        };

        if (!available) return h("div", { className: "dclAgentMeta", title: "DSH 子 Agent 的模型由上级会话决定" }, "模型继承自上级会话");

        return h(React.Fragment, null,
          sharedNative?h("div",{className:"dclAgentMeta"},`共享原生会话 · 模型修改也影响 DSH${sharedWith.length?`、${sharedWith.map(item=>item.name).join("、")}`:""}`):null,
          h("div", { style: { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" } },
            h("button", { ref: triggerRef, className: "dclAgentBtn dclModelTrigger", onClick: () => void show(), disabled: busy, title: "从 DSH 模型目录选择" }, busy ? "模型加载中…" : currentModel),
            currentReasoning?.efforts?.length && state.current ? h("select", {
              className: "dclPolicySelect",
              value: effectiveEffort ?? "",
              onChange: (event) => void selectEffort(event.target.value),
              title: "推理强度"
            },
              currentReasoning.defaultEffort === undefined ? h("option", { value: "" }, "默认强度") : null,
              currentReasoning.efforts.map((effort) => h("option", { key: effort.id, value: effort.id }, effort.name))
            ) : null
          ),
          open ? h("div", {
            className: "dclModelBackdrop",
            role: "presentation",
            onMouseDown: (event) => { if (event.target === event.currentTarget) close(); },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }
          },
            h("section", { ref: dialogRef, tabIndex: -1, className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": "选择 Agent 模型" },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, "选择模型"),
                  h("div", { className: "dclAgentMeta" }, "直接使用 DSH 已配置的供应商和模型，无需输入模型 ID。")
                ),
                h("button", { className: "dclClose", onClick: close, "aria-label": "关闭模型选择器" }, "×")
              ),
              localError || state.error ? h("div", { className: "dclError", role: "alert" }, localError || state.error) : null,
              sharedNative?h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:confirmShared,onChange:event=>setConfirmShared(event.target.checked)}),"确认修改共享原生会话的模型；不是仅影响本对话"):null,
              h("div", { className: "dclModelList", role: "radiogroup", "aria-label": "可用模型" },
                state.groups.length === 0 && !busy ? h("div", { className: "dclEmpty" }, "DSH 当前没有返回可选模型。请先在 DSH 中配置模型供应商。") : state.groups.map((group) =>
                  h("div", { key: group.id, className: "dclModelGroup" },
                    h("div", { className: "dclModelGroupTitle" }, group.name ?? group.id),
                    group.models.map((model) => h("button", {
                      key: model.id,
                      className: "dclModelRow",
                      role: "radio",
                      "aria-checked": state.current?.provider === group.id && state.current?.model === model.id,
                      disabled: busy||sharedNative&&!confirmShared,
                      onClick: () => void selectModel(group, model)
                    },
                      h("span", { className: "dclModelRowName" }, model.name ?? model.id),
                      h("span", { className: "dclAgentMeta", title: model.id }, model.id),
                      h("span", { className: "dclModelSelected" }, state.current?.provider === group.id && state.current?.model === model.id ? lineIcon("check") : null)
                    ))
                  )
                )
              )
            )
          ) : null
        );
      }

      function CharterMemory({ room, onRefresh, onDraft }) {
        const [memory, setMemory] = React.useState(null);
        const [failure, setFailure] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const [confirmation, setConfirmation] = React.useState(null);
        const confirmationRef = React.useRef(null);
        React.useEffect(() => {
          if (confirmation) {
            confirmationRef.current?.scrollIntoView({ block: "nearest" });
            confirmationRef.current?.focus();
          }
        }, [confirmation]);
        React.useEffect(() => {
          let stopped = false;
          let inFlight = false;
          const refresh = async () => {
            if (inFlight || document.hidden) return;
            inFlight = true;
            try {
              const value = await api(`/rooms/${encodeURIComponent(room.id)}/memory`);
              if (!stopped) { setMemory(value); setFailure(""); }
            } catch (cause) { if (!stopped) setFailure(cause.message ?? String(cause)); }
            finally { inFlight = false; }
          };
          void refresh();
          const timer = setInterval(refresh, 2000);
          return () => { stopped = true; clearInterval(timer); };
        }, [room.id]);
        const act = async () => {
          if (!confirmation || busy) return;
          setBusy(true);
          try {
            const base = `/rooms/${encodeURIComponent(room.id)}`;
            await api(confirmation.kind === "restore" ? `${base}/profile/restore` : `${base}/proposals/${encodeURIComponent(confirmation.id)}/dismiss`, {
              method: "POST", body: JSON.stringify({ revision: confirmation.revision, expectedRevision: confirmation.expectedRevision })
            });
            setMemory(await api(`${base}/memory`));
            await onRefresh();
            setConfirmation(null);
          } catch (cause) { setFailure(cause.message ?? String(cause)); }
          finally { setBusy(false); }
        };
        const status = { pending: "等待确认", applied: "已生效", changes_requested: "需要修订", superseded: "已被替代", dismissed: "已搁置" };
        const diff = (before, after) => {
          const a = (before || "").split("\n"), b = (after || "").split("\n");
          let start = 0, end = 0;
          while (start < a.length && start < b.length && a[start] === b[start]) start++;
          while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
          if (start === a.length && start === b.length) return h("p", { className: "dclAgentMeta" }, "未改动");
          return h("div", { className: "dclCharterDiff" },
            a.slice(Math.max(0, start - 1), start).map((line, i) => h("div", { key: `c${i}` }, `  ${line}`)),
            a.slice(start, a.length - end).map((line, i) => h("div", { key: `d${i}`, className: "removed" }, `− ${line || "（空行）"}`)),
            b.slice(start, b.length - end).map((line, i) => h("div", { key: `a${i}`, className: "added" }, `+ ${line || "（空行）"}`)),
            end ? h("div", null, `  ${b[b.length - end]}`) : null
          );
        };
        const compare = (before, after) => h(React.Fragment, null,
          before.purpose !== after.purpose ? h(React.Fragment, null, h("div", { className: "dclCharterLabel" }, "目标变更"), diff(before.purpose, after.purpose)) : null,
          h("div", { className: "dclCharterLabel" }, "章程变更 · − 删除 / + 新增"), diff(before.charter, after.charter)
        );
        const active = memory?.proposals.filter((item) => ["pending", "changes_requested"].includes(item.status)) ?? [];
        const card = (proposal) => h("details", { key: proposal.id, className: "dclMemoryCard" },
          h("summary", null, h("span", { className: `dclMemoryStatus ${proposal.status}` }, status[proposal.status] ?? proposal.status), h("span", null, proposal.reason)),
          h("p", { className: "dclAgentMeta" }, `${proposal.proposer.alias} 提交 · 基于 v${proposal.baseRevision} · ${new Date(proposal.createdAt).toLocaleString()}`),
          compare(proposal.before, proposal.profile),
          h("div", { className: "dclCharterLabel" }, "成员确认"),
          proposal.reviewers.map((member) => {
            const review = proposal.reviews.find((item) => item.sessionId === member.sessionId);
            return h("div", { className: "dclReviewLine", key: member.sessionId },
              h("strong", null, member.alias), h("span", null, review ? (review.verdict === "approve" ? "已确认" : "提出异议") : "未确认"),
              review ? h("p", null, review.comment) : null
            );
          }),
          h("details", { className: "dclMemorySources" }, h("summary", null, `讨论依据 · ${proposal.sources.length} 条（保留原文快照）`),
            proposal.sources.map((source) => h("blockquote", { key: source.id }, h("strong", null, source.authorAlias || (source.author === "human:me" ? "我" : source.author)), h("p", null, source.text)))
          ),
          proposal.closeReason ? h("p", { className: "dclAgentMeta" }, proposal.closeReason) : null,
          ["pending", "changes_requested"].includes(proposal.status) ? h("div", { className: "dclLedgerActions" },
            h("button", { className: "dclSecondary", disabled: busy, onClick: () => onDraft(`请继续处理章程修订 ${proposal.id}。先读取 chat_memory，${proposal.status === "pending" ? "尚未确认的成员请独立审阅并通过 chat_charter_review 明确确认或提出异议" : "请针对已记录的异议讨论并提出修订稿，以 replacesProposalId 关联原提案"}；不要把未确认的内容宣称为现行规则。`) }, proposal.status === "pending" ? "请成员继续审阅" : "请成员处理异议"),
            h("button", { className: "dclAgentBtn", disabled: busy, onClick: () => setConfirmation({ kind: "dismiss", id: proposal.id }) }, "搁置")
          ) : null
        );
        return h("section", { className: "dclCharterSection dclMemory", "aria-label": "章程自更新" },
          h("div", { className: "dclMemoryHeading" }, h("div", { className: "dclCharterLabel" }, "讨论 → 修订 → 共识 → 生效"), h("span", { className: "dclMemoryVersion" }, `现行 v${memory?.profile.revision ?? room.profile?.revision ?? 1}`)),
          h("p", { className: "dclAgentMeta" }, "成员可以根据讨论自行整理规则。提交者与其余成员全部确认后自动生效；有异议则保留现行章程。只更新房间约定，不改变权限。"),
          h("button", { className: "dclSecondary", onClick: () => onDraft("请根据本房间已有讨论，梳理值得长期遵守的目标、协作规则和科学纪律。先读取 chat_memory 并核对现行章程；有必要时由一位成员通过 chat_charter_propose 提交有原讨论依据的完整修订稿，其余成员独立审阅并通过 chat_charter_review 确认或提出异议。保留用户的明确要求；没有实质新增规则就不修改。") }, "请成员梳理章程"),
          h("p", { className: "dclAgentMeta" }, "点击后填入消息草稿，由你发送启动。审阅沿用协作轮次上限，未完成的提案保留待审。"),
          failure ? h("div", { role: "alert", className: "dclError" }, failure) : null,
          !memory ? (failure ? null : h("p", { role: "status" }, "正在读取修订记录…")) : h(React.Fragment, null,
            h("div", { className: "dclCharterLabel" }, `待处理修订 · ${active.length}`),
            active.length ? active.map(card) : h("p", { className: "dclAgentMeta" }, "暂无待处理修订。讨论产生新的长期约定时，成员可自行提交。"),
            h("details", { className: "dclMemoryArchive" }, h("summary", null, `生效版本 · ${memory.history.length}`),
              [...memory.history].reverse().map((entry) => h("details", { key: entry.profile.revision, className: "dclMemoryCard" },
                h("summary", null, `v${entry.profile.revision} · ${entry.reason}`),
                h("p", { className: "dclAgentMeta" }, new Date(entry.at).toLocaleString()),
                h("p", { className: "dclAgentMeta" }, `从此版本到现行 v${memory.profile.revision} 的差异`),
                compare(entry.profile, memory.profile),
                h("details", null, h("summary", null, "查看此版本全文"), h("p", { className: "dclCharterText" }, entry.profile.purpose), h("pre", { className: "dclCharterText" }, entry.profile.charter || "（空章程）")),
                entry.profile.revision !== memory.profile.revision ? h("button", { className: "dclSecondary", style: { marginTop: 10 }, disabled: busy, onClick: () => setConfirmation({ kind: "restore", revision: entry.profile.revision, expectedRevision: memory.profile.revision }) }, `恢复 v${entry.profile.revision} 的内容…`) : null
              ))
            ),
            memory.proposals.some((item) => !["pending", "changes_requested"].includes(item.status)) ? h("details", { className: "dclMemoryArchive" }, h("summary", null, "已结束的修订"), [...memory.proposals].reverse().filter((item) => !["pending", "changes_requested"].includes(item.status)).map(card)) : null
          ),
          confirmation ? h("div", { className: "dclMemoryConfirm", ref: confirmationRef, tabIndex: -1, role: "group", "aria-label": "确认章程操作" },
            h("p", null, confirmation.kind === "restore" ? `将 v${confirmation.revision} 的内容作为新版本生效，并使待审旧提案失效。已有历史不会删除。确认恢复？` : "搁置这项修订？保留讨论和审核记录，不修改现行章程。"),
            h("button", { className: "dclSecondary", disabled: busy, onClick: () => void act() }, busy ? "保存中…" : "确认"),
            h("button", { className: "dclAgentBtn", disabled: busy, onClick: () => setConfirmation(null) }, "取消")
          ) : null
        );
      }

      return function ChatBody(props) {
        const [rooms, setRooms] = React.useState([]);
        const [groups,setGroups]=React.useState([]);
        const [workspaceDraft,setWorkspaceDraft]=React.useState(null);
        const [topPage,setTopPage]=React.useState(null);
        const [groupSettings,setGroupSettings]=React.useState(null);
        const [teamSelection,setTeamSelection]=React.useState(null);
        const teamReceipt=React.useRef(null);
        const [workspaceData,setWorkspaceData]=React.useState({drafts:[],rosters:[]});
        const workspaceRequest=React.useRef(0);
        const [groupChoice,setGroupChoice]=React.useState("");
        const [conversationBusy,setConversationBusy]=React.useState(false);
        const conversationCreationRef=React.useRef(null);
        const sourceJumpRef=React.useRef(null);
        const [trashedRooms, setTrashedRooms] = React.useState([]);
        const [roomsLoading, setRoomsLoading] = React.useState(true);
        const [selectedId, setSelectedId] = React.useState(null);
        const roomScopeRef=React.useRef({id:selectedId,generation:0});
        if(roomScopeRef.current.id!==selectedId)roomScopeRef.current={id:selectedId,generation:roomScopeRef.current.generation+1};
        const [messages, setMessages] = useRoomState(roomScopeRef, []);
        const [draft, setDraft] = useRoomState(roomScopeRef, "");
        const [mentionAll, setMentionAll] = useRoomState(roomScopeRef, false);
        const [mentionIds, setMentionIds] = useRoomState(roomScopeRef, []);
        const [newName, setNewName] = React.useState("");
        const [roomComposerOpen, setRoomComposerOpen] = React.useState(false);
        const [copyTeam,setCopyTeam]=React.useState(false);
        const [groupSource,setGroupSource]=React.useState(null);
        const [groupCreateError,setGroupCreateError]=React.useState("");
        const groupCreationRef=React.useRef(false);
        const [conversationQuery,setConversationQuery]=React.useState("");
        const [conversationSearchOpen,setConversationSearchOpen]=React.useState(false);
        const [error, setError] = useRoomState(roomScopeRef, "");
        const [notice, setNotice] = useRoomState(roomScopeRef, "");
        const [branchDraft,setBranchDraft]=useRoomState(roomScopeRef,null);
        const [defaultsDraft,setDefaultsDraft]=useRoomState(roomScopeRef,null);
        const [sessionState, setSessionState] = React.useState(sessionsSnapshot);
        const [participants, setParticipants] = useRoomState(roomScopeRef, []);
        const [artifacts, setArtifacts] = useRoomState(roomScopeRef, []);
        const [artifactQuery,setArtifactQuery]=useRoomState(roomScopeRef, "");
        const [ledger, setLedger] = useRoomState(roomScopeRef, []);
        const [ledgerFilter, setLedgerFilter] = useRoomState(roomScopeRef, "open");
        const [ledgerQuery,setLedgerQuery]=useRoomState(roomScopeRef, "");
        const [focusedLedgerId, setFocusedLedgerId] = useRoomState(roomScopeRef, null);
        const [ledgerConfirmation, setLedgerConfirmation] = useRoomState(roomScopeRef, null);
        const [managementDialog,setManagementDialog]=useRoomState(roomScopeRef,null);
        const [retryDialog,setRetryDialog]=useRoomState(roomScopeRef,null);
        const [recoveryReturn,setRecoveryReturn]=useRoomState(roomScopeRef, null);
        const [ledgerReviewSummary, setLedgerReviewSummary] = useRoomState(roomScopeRef, "");
        const [ledgerDecisionChoice, setLedgerDecisionChoice] = useRoomState(roomScopeRef, "");
        const [notifyDecision, setNotifyDecision] = useRoomState(roomScopeRef, true);
        const [permissionAcknowledged, setPermissionAcknowledged] = useRoomState(roomScopeRef, false);
        const [preview, setPreview] = useRoomState(roomScopeRef, null);
        const [previewLoading, setPreviewLoading] = useRoomState(roomScopeRef, false);
        const [previewExpanded, setPreviewExpanded] = useRoomState(roomScopeRef, false);
        const [inspectorMode, setInspectorMode] = useRoomState(roomScopeRef, null);
        const [newAgentName, setNewAgentName] = useRoomState(roomScopeRef, "");
        const [pickerOpen, setPickerOpen] = useRoomState(roomScopeRef, false);
        const [sessionQuery, setSessionQuery] = useRoomState(roomScopeRef, "");
        const [attachingSessionId, setAttachingSessionId] = useRoomState(roomScopeRef, "");
        const [pendingRemoval, setPendingRemoval] = useRoomState(roomScopeRef, null);
        const [pendingRoomDelete, setPendingRoomDelete] = useRoomState(roomScopeRef, null);
        const [editingMember, setEditingMember] = useRoomState(roomScopeRef, null);
        const [editingLedger, setEditingLedger] = useRoomState(roomScopeRef, null);
        const [correctionTarget, setCorrectionTarget] = useRoomState(roomScopeRef, null);
        const [correctionDraft, setCorrectionDraft] = useRoomState(roomScopeRef, "");
        const [searchQuery, setSearchQuery] = useRoomState(roomScopeRef, "");
        const [searchAuthor, setSearchAuthor] = useRoomState(roomScopeRef, "");
        const [searchDeliveryStatus, setSearchDeliveryStatus] = useRoomState(roomScopeRef, "");
        const [searchResults, setSearchResults] = useRoomState(roomScopeRef, []);
        const [searchBusy, setSearchBusy] = useRoomState(roomScopeRef, false);
        const [retryingMessageId, setRetryingMessageId] = useRoomState(roomScopeRef, "");
        const [historyMode, setHistoryMode] = useRoomState(roomScopeRef, false);
        const [roomNameDraft, setRoomNameDraft] = useRoomState(roomScopeRef, "");
        const [roomPurposeDraft, setRoomPurposeDraft] = useRoomState(roomScopeRef, "");
        const [roomCharterDraft, setRoomCharterDraft] = useRoomState(roomScopeRef, "");
        const [roomDetailsRevision, setRoomDetailsRevision] = useRoomState(roomScopeRef, 1);
        const [managementBusy, setManagementBusy] = useRoomState(roomScopeRef, false);
        const [creating, setCreating] = useRoomState(roomScopeRef, false);
        const [creatingRoom, setCreatingRoom] = React.useState(false);
        const [settingsBusy, setSettingsBusy] = useRoomState(roomScopeRef, false);
        const [sending, setSending] = useRoomState(roomScopeRef, false);
        const [exporting, setExporting] = useRoomState(roomScopeRef, false);
        const [savedExport, setSavedExport] = useRoomState(roomScopeRef, null);
        const [roomSidebarOpen, setRoomSidebarOpen] = React.useState(true);
        const [compactWorkspace, setCompactWorkspace] = React.useState(false);
        const [overlayInspector, setOverlayInspector] = React.useState(false);
        const [syncError, setSyncError] = useRoomState(roomScopeRef, "");
        const [roomListError, setRoomListError] = React.useState("");
        const workspaceRef = React.useRef(null);
        const textareaRef = React.useRef(null);
        const composing = React.useRef(false);
        const selectedIdRef = React.useRef(null);
        const roomUiRef = React.useRef(new Map());
        const timelineRef = React.useRef(null);
        const atBottomRef = React.useRef(true);
        const historyModeRef = React.useRef(false);
        const previousMessageCount = React.useRef(0);
        const previousMessageIds = React.useRef(new Set());
        const previewRequest = React.useRef(0);
        const draftRef = React.useRef("");
        const pendingSends = React.useRef(new Map());
        const [newMessageCount, setNewMessageCount] = React.useState(0);
        const [highlightedMessageId, setHighlightedMessageId] = React.useState(null);
        selectedIdRef.current = selectedId;
        draftRef.current = draft;
        historyModeRef.current = historyMode;

        React.useLayoutEffect(() => {
          const element = workspaceRef.current;
          if (!element) return undefined;
          let wasCompact;
          const update = () => {
            const width = element.getBoundingClientRect().width;
            if (width <= 0) return;
            const compact = width <= 680;
            setCompactWorkspace(compact);
            setOverlayInspector(width < 1120);
            if (compact && wasCompact !== true) setRoomSidebarOpen(false);
            wasCompact = compact;
          };
          update();
          const observer = new ResizeObserver(update);
          observer.observe(element);
          return () => observer.disconnect();
        }, []);

        React.useLayoutEffect(() => {
          const element = textareaRef.current;
          if (element) {
            element.style.height = "auto";
            element.style.height = `${Math.min(180, element.scrollHeight)}px`;
          }
        }, [draft, selectedId]);

        React.useEffect(() => {
          const unsubscribe = ctx.sessions?.list?.subscribe?.(() => setSessionState(sessionsSnapshot()));
          return () => unsubscribe?.();
        }, []);

        React.useEffect(() => {
          let stopped = false;
          let inFlight=false;
          const refresh = async () => {
            if(inFlight||document.hidden)return;
            inFlight=true;
            try {
              const [value, deleted, nextGroups, nextWorkspace] = await Promise.all([api("/rooms"), api("/rooms/trash"),api("/groups"),api("/workspace")]);
              if (!stopped) {
                setRooms(value);
                setTrashedRooms(deleted);
                setGroups(nextGroups);
                setWorkspaceData(withLocalWorkspaceDrafts(nextWorkspace));
                setRoomListError("");
                if (!topPage&&!groupSettings&&!workspaceDraft&&!selectedId && value[0]) {
                  let rememberedRoomId = "";
                  try { rememberedRoomId = sessionStorage.getItem("dcl:last-room") ?? ""; } catch { /* storage can be unavailable */ }
                  setSelectedId(groupChoice ? value.find(room=>room.groupId===groupChoice)?.id??null : value.some((room) => room.id === rememberedRoomId) ? rememberedRoomId : value[0].id);
                } else if (selectedId && !value.some((room) => room.id === selectedId)) {
                  setSelectedId(value.find(room=>!groupChoice||room.groupId===groupChoice)?.id ?? null);
                }
              }
            } catch (cause) { if (!stopped) setRoomListError(`房间列表暂未同步，正在自动重连。${cause.message ? `（${cause.message}）` : ""}`); }
            finally { inFlight=false; if (!stopped) setRoomsLoading(false); }
          };
          void refresh();
          const timer = setInterval(refresh, 2500);
          return () => { stopped = true; clearInterval(timer); };
        }, [selectedId,groupChoice,workspaceDraft?.id,topPage,groupSettings?.id]);

        React.useEffect(() => {
          let rememberedDraft = "";
          try { rememberedDraft = selectedId ? sessionStorage.getItem(`dcl:draft:${selectedId}`) ?? "" : ""; } catch { /* storage can be unavailable */ }
          let storedUi={},pending;
          try { storedUi=JSON.parse(sessionStorage.getItem(`dcl:ui:${selectedId}`)??"{}"); pending=JSON.parse(sessionStorage.getItem(`dcl:pending:${selectedId}`)??"null"); }catch{/* incomplete browser storage is ignored */}
          if(pending&&typeof pending.id==="string"&&typeof pending.key==="string"&&typeof pending.text==="string"&&Array.isArray(pending.mentions))pendingSends.current.set(selectedId,pending);else pending=null;
          const rememberedUi = roomUiRef.current.get(selectedId) ?? storedUi ?? {};
          const recoveredPending = !rememberedUi.draft && !rememberedDraft && pending;
          setDraft(rememberedUi.draft || rememberedDraft || pending?.text || "");
          setMentionAll(recoveredPending ? pending.mentions.includes("all") : Boolean(rememberedUi.mentionAll));
          setMentionIds(recoveredPending ? pending.mentions.filter(id => id !== "all") : Array.isArray(rememberedUi.mentionIds) ? rememberedUi.mentionIds : []);
          setError("");
          setSyncError("");
          setNotice("");
          setInspectorMode(null);
          setPendingRemoval(null);
          setPendingRoomDelete(null);
          setEditingMember(null);
          setEditingLedger(null);
          setCorrectionTarget(null);
          setCorrectionDraft("");
          setBranchDraft(null);setDefaultsDraft(null);
          setManagementBusy(false);setSettingsBusy(false);setCreating(false);setSending(false);setSearchBusy(false);setRetryingMessageId("");setAttachingSessionId("");setExporting(false);
          setSearchQuery("");
          setSearchAuthor("");
          setSearchDeliveryStatus("");
          setSearchResults([]);
          setHistoryMode(false);
          historyModeRef.current = false;
          setPreview(null);
          setPreviewExpanded(false);
          setSavedExport(null);
          previewRequest.current+=1;
          setPreviewLoading(false);
          setMessages([]);
          setParticipants([]);
          setArtifacts([]);
          setArtifactQuery("");
          setLedger([]);
          setLedgerFilter("open");
          setLedgerQuery("");setRecoveryReturn(null);
          setFocusedLedgerId(null);
          setLedgerConfirmation(null);
          setNewMessageCount(0);
          previousMessageCount.current = 0;
          previousMessageIds.current = new Set();
          atBottomRef.current = true;
          setPickerOpen(false);
          setSessionQuery("");
          if (selectedId) {
            try { sessionStorage.setItem("dcl:last-room", selectedId); } catch { /* storage can be unavailable */ }
          }
          if (!selectedId) { setMessages([]); setParticipants([]); setArtifacts([]); setLedger([]); return; }
          let stopped = false;
          let inFlight=false;
          const refresh = async () => {
            if(inFlight||document.hidden)return;
            inFlight=true;
            try {
              const [nextMessages, nextParticipants, nextArtifacts, nextLedger] = await Promise.all([
                api(`/rooms/${encodeURIComponent(selectedId)}/messages?limit=200`),
                api(`/rooms/${encodeURIComponent(selectedId)}/participants`),
                api(`/rooms/${encodeURIComponent(selectedId)}/artifacts`),
                api(`/rooms/${encodeURIComponent(selectedId)}/ledger?includeArchived=true`)
              ]);
              if (!stopped) {
                if (!historyModeRef.current) setMessages(nextMessages);
                const pending=pendingSends.current.get(selectedId);
                if(pending&&nextMessages.some(message=>message.clientOperationId===pending.id&&!message.savePending)) {
                  pendingSends.current.delete(selectedId);
                  try {sessionStorage.removeItem(`dcl:pending:${selectedId}`);}catch{}
                  if(draftRef.current.trim()===pending.text){setDraft("");setMentionAll(false);setMentionIds([]);rememberRoomUi(selectedId,{draft:"",mentionAll:false,mentionIds:[]});setNotice("已确认上次消息保存成功，未重复发送。");}
                }
                setParticipants(nextParticipants);
                setArtifacts(nextArtifacts);
                setLedger(nextLedger);
                setSyncError("");
              }
            } catch (cause) { if (!stopped) setSyncError(`群聊暂未同步，正在自动重连。${cause.message ? `（${cause.message}）` : ""}`); }
            finally { inFlight=false; }
          };
          void refresh();
          const timer = setInterval(refresh, 1000);
          return () => { stopped = true; clearInterval(timer); };
        }, [selectedId]);

        React.useEffect(() => {
          const element = timelineRef.current;
          const nextCount = messages.length;
          const delta = previousMessageIds.current.size ? messages.filter(message=>!previousMessageIds.current.has(message.id)).length : 0;
          if (element && (atBottomRef.current || previousMessageCount.current === 0)) {
            element.scrollTop = element.scrollHeight;
            setNewMessageCount(0);
          } else if (delta > 0) {
            setNewMessageCount((count) => count + delta);
          }
          previousMessageCount.current = nextCount;
          previousMessageIds.current=new Set(messages.map(message=>message.id));
        }, [messages]);

        React.useEffect(() => {
          const element = timelineRef.current;
          if (!element) return undefined;
          const observer = new ResizeObserver(() => {
            if (atBottomRef.current && !historyModeRef.current) element.scrollTop = element.scrollHeight;
          });
          observer.observe(element);
          if (element.firstElementChild) observer.observe(element.firstElementChild);
          return () => observer.disconnect();
        }, [selectedId]);

        React.useLayoutEffect(() => {
          if (typeof document === "undefined") return undefined;
          props?.entryFocusRef?.current?.focus();
        }, []);

        React.useEffect(() => {
          if (!notice) return undefined;
          const timer = setTimeout(() => setNotice(""), 6000);
          return () => clearTimeout(timer);
        }, [notice]);

        React.useEffect(() => {
          if (!highlightedMessageId) return undefined;
          const timer = setTimeout(() => setHighlightedMessageId(null), 2200);
          return () => clearTimeout(timer);
        }, [highlightedMessageId]);

        React.useEffect(() => {
          const closeInnerLayer = (event) => {
            if (event.key !== "Escape") return;
            if(event.target?.closest?.('[data-dcl-group-picker],.dclConversationSearch'))return;
            if (event.target?.closest?.('[role="dialog"]') && !event.target?.closest?.('.dclInspector,.dclSide') && !(pendingRemoval||pendingRoomDelete||editingMember||editingLedger||ledgerConfirmation||correctionTarget)) return;
            if(managementBusy||settingsBusy)return;
            if (pendingRemoval) {
              event.preventDefault();
              event.stopPropagation();
              setPendingRemoval(null);
              return;
            }
            if (pendingRoomDelete) {
              event.preventDefault();
              event.stopPropagation();
              setPendingRoomDelete(null);
              return;
            }
            if (editingMember) {
              event.preventDefault();
              event.stopPropagation();
              setEditingMember(null);
              return;
            }
            if (editingLedger) {
              event.preventDefault();
              event.stopPropagation();
              setEditingLedger(null);
              return;
            }
            if (ledgerConfirmation) {
              event.preventDefault();
              event.stopPropagation();
              if (!managementBusy) setLedgerConfirmation(null);
              return;
            }
            if (correctionTarget) {
              event.preventDefault();
              event.stopPropagation();
              setCorrectionTarget(null);
              setCorrectionDraft("");
              return;
            }
            if (inspectorMode) {
              event.preventDefault();
              event.stopPropagation();
              setInspectorMode(null);
              return;
            }
            if (roomComposerOpen) {
              event.preventDefault();
              event.stopPropagation();
              if(!creatingRoom)setRoomComposerOpen(false);
              return;
            }
            if (compactWorkspace && roomSidebarOpen) {
              event.preventDefault();
              setRoomSidebarOpen(false);
            }
          };
          window.addEventListener("keydown", closeInnerLayer, true);
          return () => window.removeEventListener("keydown", closeInnerLayer, true);
        }, [inspectorMode, roomComposerOpen, creatingRoom, pendingRemoval, pendingRoomDelete, editingMember, editingLedger, ledgerConfirmation, managementBusy, settingsBusy, correctionTarget, compactWorkspace, roomSidebarOpen]);

        React.useEffect(() => {
          if(!(pendingRemoval||pendingRoomDelete||editingMember||editingLedger||ledgerConfirmation||managementDialog||retryDialog||correctionTarget||pickerOpen||branchDraft||defaultsDraft||roomComposerOpen))return;
          const previous=document.activeElement;
          const modal=workspaceRef.current?.querySelector('.dclModelDialog[role="dialog"],.dclPicker[role="dialog"]');
          if(!modal)return;
          const backgrounds=[...workspaceRef.current.querySelectorAll('.dclMain,.dclSide,.dclInspector')].filter(el=>el!==modal&&!el.contains(modal)).map(el=>({el,inert:el.inert}));
          for(const {el} of backgrounds)el.inert=true;
          const controls=()=>[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
          if(!modal.contains(document.activeElement))(modal.querySelector('[data-dcl-initial-focus="true"]')??controls()[0])?.focus();
          const trap=event=>{if(event.key!=="Tab"||event.defaultPrevented)return;const elements=controls(),first=elements[0],last=elements.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus();}};
          modal.addEventListener("keydown",trap);
          return()=>{modal.removeEventListener("keydown",trap);for(const {el,inert} of backgrounds)el.inert=inert;if(previous?.isConnected)previous.focus({preventScroll:true});};
        }, [Boolean(pendingRemoval),Boolean(pendingRoomDelete),Boolean(editingMember),Boolean(editingLedger),ledgerConfirmation?.kind,Boolean(managementDialog),Boolean(retryDialog),Boolean(correctionTarget),pickerOpen,Boolean(branchDraft),Boolean(defaultsDraft),roomComposerOpen]);

        React.useEffect(()=>{
          if(!inspectorMode||!overlayInspector)return;
          const root=workspaceRef.current, main=root?.querySelector('.dclMain'), side=root?.querySelector('.dclSide'),panel=root?.querySelector('.dclInspector');
          const previous=document.activeElement;
          if(main)main.inert=true;if(side)side.inert=true;
          (panel?.querySelector('[data-dcl-initial-focus="true"]')??panel?.querySelector('button'))?.focus({preventScroll:true});
          return()=>{if(main)main.inert=false;if(side)side.inert=false;if(previous?.isConnected)previous.focus({preventScroll:true});};
        },[inspectorMode,overlayInspector]);

        React.useEffect(()=>{
          if(!compactWorkspace||!roomSidebarOpen)return;
          const root=workspaceRef.current,side=root?.querySelector('.dclSide'),main=root?.querySelector('.dclMain'),previous=document.activeElement;
          if(!side)return;
          if(main)main.inert=true;
          const controls=()=>[...side.querySelectorAll('button:not(:disabled),input:not(:disabled),select,summary')].filter(element=>element.getClientRects().length);
          controls()[0]?.focus();
          const trap=event=>{if(event.key!=="Tab")return;const list=controls(),first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
          side.addEventListener("keydown",trap);
          return()=>{side.removeEventListener("keydown",trap);if(main)main.inert=false;if(previous?.isConnected)previous.focus({preventScroll:true});};
        },[compactWorkspace,roomSidebarOpen]);

        React.useEffect(() => {
          if (!focusedLedgerId || inspectorMode !== "ledger") return;
          const element = document.getElementById(`dcl-ledger-${focusedLedgerId}`);
          element?.scrollIntoView({ block: "nearest" });
          element?.focus({ preventScroll: true });
        }, [focusedLedgerId, inspectorMode, ledgerFilter]);

        const selectedRoom = rooms.find((room) => room.id === selectedId) ?? null;
        const selectedGroup=groups.find(group=>group.id===(workspaceDraft?workspaceDraft.groupId:selectedRoom?.groupId??groupChoice))??(workspaceDraft||topPage?null:groups.find(g=>!g.archivedAt&&!g.deletedAt))??null;
        const groupRooms=rooms.filter(room=>room.groupId===selectedGroup?.id).sort((a,b)=>b.updatedAt-a.updatedAt);
        const visibleGroupRooms=filterConversations(groupRooms,conversationQuery);
        const groupTrash=trashedRooms;
        const backgroundRooms=rooms.filter(room=>room.id!==selectedId&&["running","queued"].includes(room.orchestration?.state));
        const roomCollaborationActive = selectedRoom?.orchestration?.state === "running" || selectedRoom?.orchestration?.state === "queued";
        const rememberRoomUi = (roomId, patch) => {
          if (!roomId) return;
          const next = { ...(roomUiRef.current.get(roomId) ?? {}), ...patch };
          roomUiRef.current.set(roomId, next);
          try {sessionStorage.setItem(`dcl:ui:${roomId}`,JSON.stringify(next));}catch{/* draft remains in memory */}
          if (Object.hasOwn(patch, "draft")) {
            try {
              if (patch.draft) sessionStorage.setItem(`dcl:draft:${roomId}`, patch.draft);
              else sessionStorage.removeItem(`dcl:draft:${roomId}`);
            } catch { /* storage can be unavailable */ }
          }
        };
        const currentId = sessionState?.current ? String(sessionState.current) : "";
        const currentSummary = currentId ? sessionState?.byId?.[currentId] : undefined;
        const sessionIds = Array.isArray(sessionState?.ids) ? sessionState.ids.map(String) : Object.keys(sessionState?.byId ?? {});
        const availableSessions = sessionIds.filter((id) => !participants.some((item) => item.sessionId === id));
        const sessionLabel = (id) => sessionState?.byId?.[id]?.displayTitle ?? sessionState?.byId?.[id]?.title ?? id;
        const sessionMeta = (id) => {
          const summary = sessionState?.byId?.[id];
          const cwd = summary?.cwd ? summary.cwd.split("/").filter(Boolean).slice(-2).join("/") : "未绑定工作目录";
          return `${summary?.running ? "运行中" : "空闲"} · ${cwd}`;
        };
        const normalizedQuery = sessionQuery.trim().toLocaleLowerCase();
        const filteredSessions = availableSessions.filter((id) => {
          if (!normalizedQuery) return true;
          const summary = sessionState?.byId?.[id];
          return `${sessionLabel(id)} ${summary?.cwd ?? ""} ${id}`.toLocaleLowerCase().includes(normalizedQuery);
        });
        const visibleSessions = filteredSessions.slice(0, 30);

        const refreshRooms = async () => {
          const [active, deleted, nextGroups] = await Promise.all([api("/rooms"), api("/rooms/trash"),api("/groups")]);
          setRooms(active);
          setTrashedRooms(deleted);
          setGroups(nextGroups);
          return active;
        };
        const refreshParticipants = async () => {
          if(!selectedRoom)return;
          const roomId=selectedRoom.id;
          const next=await api(`/rooms/${encodeURIComponent(roomId)}/participants`);
          if(selectedIdRef.current===roomId)setParticipants(next);
        };
        const refreshArtifacts = async () => {
          if(!selectedRoom)return;
          const roomId=selectedRoom.id;
          const next=await api(`/rooms/${encodeURIComponent(roomId)}/artifacts`);
          if(selectedIdRef.current===roomId)setArtifacts(next);
        };
        const refreshLedger = async () => {
          if (!selectedRoom) return;
          const roomId = selectedRoom.id;
          const next = await api(`/rooms/${encodeURIComponent(roomId)}/ledger?includeArchived=true`);
          if (selectedIdRef.current === roomId) setLedger(next);
        };

        const openWorkspace=async(kind="conversation",another=true,groupId=selectedGroup?.id??null)=>{
          if(kind==="group")groupId=null;
          const request=++workspaceRequest.current;
          setConversationBusy(true);
          try{
            const value=await api("/drafts",{method:"POST",body:JSON.stringify({groupId,kind,another,ephemeral:true})});
            if(request!==workspaceRequest.current)return;
            setTopPage(null);setGroupSettings(null);setTeamSelection(null);setWorkspaceDraft(value);setInspectorMode(null);setGroupChoice(groupId??"");setSelectedId(null);
            if(compactWorkspace)setRoomSidebarOpen(false);
          }catch(cause){if(request===workspaceRequest.current)setRoomListError(`无法打开草稿：${cause.message??cause}`);}
          finally{if(request===workspaceRequest.current)setConversationBusy(false);}
        };
        const openGroupComposer=()=>void openWorkspace("group",true,null);
        const closeWorkspace=()=>{workspaceRequest.current++;setConversationBusy(false);setWorkspaceDraft(null);setGroupSettings(null);setTopPage("groups");void api("/workspace").then(value=>setWorkspaceData(withLocalWorkspaceDrafts(value))).catch(()=>{});};
        const openHome=page=>{closeWorkspace();setTopPage(page);setSelectedId(null);setInspectorMode(null);setTeamSelection(null);if(compactWorkspace)setRoomSidebarOpen(false);};
        const resumeWorkspace=async item=>{const request=++workspaceRequest.current;setConversationBusy(false);const fresh=await api("/workspace").catch(()=>null);if(request!==workspaceRequest.current)return;setTopPage(null);setGroupSettings(null);setWorkspaceDraft(fresh?.drafts.find(draft=>draft.id===item.id)??item);setInspectorMode(null);setSelectedId(null);setGroupChoice(item.groupId??"");if(compactWorkspace)setRoomSidebarOpen(false);};
        const completeWorkspace=async(result,navigationToken)=>{
          if(navigationToken!==workspaceRequest.current){void refreshRooms().catch(()=>{});return;}
          const finishedId=workspaceDraft?.id;setWorkspaceDraft(null);setTopPage(null);setGroupSettings(null);
          setWorkspaceData(data=>({...data,drafts:data.drafts.filter(draft=>draft.id!==finishedId)}));
          if(result.group){
            setGroups(list=>[...list.filter(group=>group.id!==result.group.id),{...result.group,conversationCount:0,runningCount:0}]);setGroupChoice(result.group.id);setSelectedId(null);
            if(!result.saveOnly)await openWorkspace("conversation",true,result.group.id);
          }else if(result.room){setRooms(list=>[result.room,...list.filter(room=>room.id!==result.room.id)]);setGroupChoice(result.room.groupId);setSelectedId(result.room.id);if(result.state==="check_results")setNotice("对话与首条消息已保存；执行结果待核对，不会自动重播。");}
          void refreshRooms().catch(()=>setRoomListError("操作已保存；列表暂未同步，正在重连。"));
        };
        const chooseGroup=(id,roomId)=>{
          closeWorkspace();
          setTopPage(null);setInspectorMode(null);
          setConversationQuery("");setConversationSearchOpen(false);setGroupChoice(id);
          const recent=rooms.filter(room=>room.groupId===id).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
          setSelectedId(roomId??recent?.id??null);
          const group=groups.find(g=>g.id===id);
          if(!roomId&&!recent&&!group?.archivedAt&&!group?.deletedAt)void openWorkspace("conversation",true,id);
        };
        const openGroupSettings=group=>{closeWorkspace();setTopPage(null);setGroupSettings(group);setSelectedId(null);setInspectorMode(null);setGroupChoice(group.id);if(compactWorkspace)setRoomSidebarOpen(false);};
        const openTeamSelection=async initialMode=>{
          if(!selectedRoom)return;const roomId=selectedRoom.id;
          try{const [config,groupConfig]=await Promise.all([api(`/rooms/${encodeURIComponent(roomId)}/selection`),selectedRoom.groupId?api(`/groups/${encodeURIComponent(selectedRoom.groupId)}/configuration?all=true`):Promise.resolve(null)]);if(selectedIdRef.current!==roomId)return;teamReceipt.current=null;setTeamSelection({...config,groupMembers:groupConfig?.members??[],roomId,initialMode,confirmed:false});setInspectorMode(null);}catch(cause){setError(cause.message);}
        };
        const applyTeamSelection=async members=>{
          const selection=teamSelection;
          const body={members,environment:selection.environment,expectedRevision:selection.revision,confirmRisk:selection.confirmed},key=JSON.stringify(body);
          if(teamReceipt.current?.key!==key)teamReceipt.current={key,operationId:crypto.randomUUID()};
          const room=await api(`/rooms/${encodeURIComponent(selection.roomId)}/selection`,{method:"POST",body:JSON.stringify({...body,operationId:teamReceipt.current.operationId})});
          setRooms(list=>list.map(item=>item.id===room.id?room:item));
          if(selectedIdRef.current===room.id){setTeamSelection(null);setInspectorMode("participants");void refreshParticipants().catch(()=>{});setNotice("本對話參與者已更新；群組預設不變，尚未啟動工作。");}
        };
        const createRoom = async () => {
          if (!newName.trim() || creatingRoom || groupCreationRef.current || groupNameIssue(newName,rooms)) return;
          groupCreationRef.current=true;
          setCreatingRoom(true);
          try {
            setGroupCreateError("");
            const room = await api("/rooms", { method: "POST", body: JSON.stringify({ name: newName.trim(), autoDeliver: true,...(copyTeam&&groupSource?{copyFromRoomId:groupSource.id}:{}) }) });
            // A committed creation stays successful even if the subsequent list refresh is offline.
            setRooms(list=>[room,...list.filter(item=>item.id!==room.id)]);
            setGroups(list=>[{id:room.groupId,name:room.name,conversationCount:1,runningCount:0},...list.filter(item=>item.id!==room.groupId)]);
            setNewName("");
            setRoomComposerOpen(false);
            setCopyTeam(false);
            setGroupSource(null);
            setConversationQuery("");setConversationSearchOpen(false);
            setGroupChoice(room.groupId);
            setSelectedId(room.id);
            if(compactWorkspace)setRoomSidebarOpen(false);
            void refreshRooms().catch(()=>setRoomListError("群组已创建；列表暂未同步，正在自动重连。"));
          } catch (cause) { setGroupCreateError(/already exists/iu.test(cause.message??"")?"这个名称已被使用，请换一个名称。":`未能确认创建成功：${cause.message??cause}。输入已保留；可先关闭弹窗核对群组列表，再重试。`); }
          finally { groupCreationRef.current=false;setCreatingRoom(false); }
        };

        const newConversation = async (branch=null) => {
          if(!selectedGroup||conversationBusy||conversationCreationRef.current?.inFlight)return;
          const request={...(branch?{sourceRoomId:selectedRoom.id,sourceMessageIds:[branch.message.id],background:branch.background,confirmRisk:Boolean(branch.confirmRisk),...(branch.title.trim()?{title:branch.title.trim()}:{})}:{})};
          const key=JSON.stringify([selectedGroup.id,request]);
          let receipt=conversationCreationRef.current;
          if(!receipt||receipt.key!==key){
            try{receipt=JSON.parse(sessionStorage.getItem("dcl:conversation-create")??"null");}catch{}
            if(!receipt||receipt.key!==key)receipt={key,operationId:crypto.randomUUID()};
          }
          receipt.inFlight=true;conversationCreationRef.current=receipt;
          try{sessionStorage.setItem("dcl:conversation-create",JSON.stringify({key,operationId:receipt.operationId}));}catch{}
          const scope=roomScopeRef.current.generation;
          setConversationBusy(true);setError("");
          try{
            const room=await api(`/groups/${encodeURIComponent(selectedGroup.id)}/conversations`,{method:"POST",body:JSON.stringify({...request,operationId:receipt.operationId})});
            setRooms(list=>[room,...list.filter(item=>item.id!==room.id)]);
            conversationCreationRef.current=null;
            try{sessionStorage.removeItem("dcl:conversation-create");}catch{}
            if(roomScopeRef.current.generation===scope){setBranchDraft(null);setConversationQuery("");setConversationSearchOpen(false);setGroupChoice(room.groupId);setSelectedId(room.id);if(compactWorkspace)setRoomSidebarOpen(false);setTimeout(()=>{if(selectedIdRef.current===room.id)textareaRef.current?.focus();},80);}
            void refreshRooms().catch(()=>setRoomListError("对话已创建；列表暂未同步，正在自动重连。"));
          }catch(cause){setError(`新对话未确认创建成功：${cause.message??cause}。重试会使用同一创建凭据，不会重复创建对话。`);}
          finally{receipt.inFlight=false;setConversationBusy(false);}
        };

        const saveDefaults = async () => {
          if(!selectedRoom||!defaultsDraft||managementBusy)return;
          setManagementBusy(true);
          try{
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/group-defaults`,{method:"POST",body:JSON.stringify({name:defaultsDraft.name,expectedRevision:defaultsDraft.roomRevision,expectedGroupRevision:defaultsDraft.groupRevision,confirmRisk:defaultsDraft.confirmRisk})});
            await refreshRooms();setDefaultsDraft(null);setNotice("已保存群组默认配置；已有对话、任务和原生会话未改变。");
          }catch(cause){setError(cause.message??String(cause));}finally{setManagementBusy(false);}
        };

        const prepareParticipant = async participant => {
          await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/members/${encodeURIComponent(participant.sessionId)}/prepare`,{method:"POST",body:"{}"});
          await refreshParticipants();
        };

        const toggleAuto = async () => {
          if (!selectedRoom || settingsBusy) return;
          setSettingsBusy(true);
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/settings`, {
              method: "POST", body: JSON.stringify({ autoDeliver: !selectedRoom.autoDeliver })
            });
            setRooms((list) => list.map((room) => room.id === value.id ? value : room));
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setSettingsBusy(false); }
        };

        const setPolicy = async (defaultActionMode, confirmRisk = false) => {
          if (!selectedRoom || settingsBusy) return;
          const roomId = selectedRoom.id;
          setSettingsBusy(true);
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/policy`, {
              method: "POST",
              body: JSON.stringify({ defaultActionMode, expectedRevision: selectedRoom.policy?.revision ?? 1, confirmRisk })
            });
            setRooms((list) => list.map((room) => room.id === value.id ? value : room));
            if (selectedIdRef.current !== roomId) return;
            setNotice(`权限已切换为「${actionModeLabel(defaultActionMode)}」。${defaultActionMode === "full_access" ? "已同步现有成员的 DSH 原生完全权限；没有自动启动任务。" : "新消息将使用此策略；原有阻断需实测后再更新。"}`);
            setLedgerConfirmation(ledgerConfirmation?.returnEntry ? { kind: "blocked", entry: ledgerConfirmation.returnEntry, roomId: selectedRoom.id } : null);
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setSettingsBusy(false); }
        };

        const requestPolicy = (mode, returnEntry, forceDialog = false) => {
          if (["inherit_dsh", "workspace_write", "full_access"].includes(mode) || returnEntry || forceDialog) {
            setPermissionAcknowledged(false); setError("");
            setLedgerConfirmation({ kind: "permission", entry: { title: "权限设置" }, mode, roomId: selectedRoom.id, returnEntry });
          } else void setPolicy(mode);
        };

        const openRoomSettings = () => {
          if (!selectedRoom) return;
          setRoomNameDraft(selectedRoom.name ?? "");
          setRoomPurposeDraft(selectedRoom.profile?.purpose ?? "");
          setRoomCharterDraft(selectedRoom.profile?.charter ?? "");
          setRoomDetailsRevision(selectedRoom.revision ?? 1);
          setInspectorMode("settings");
        };

        const saveRoomDetails = async () => {
          if (!selectedRoom || !roomNameDraft.trim() || managementBusy) return;
          setManagementBusy(true);
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/details`, {
              method: "POST",
              body: JSON.stringify({
                name: roomNameDraft.trim(),
                purpose: roomPurposeDraft.trim(),
                charter: roomCharterDraft.trim(),
                source: selectedRoom.profile?.source,
                expectedRevision: roomDetailsRevision
              })
            });
            setRooms((list) => list.map((room) => room.id === value.id ? value : room));
            setInspectorMode("profile");
            setNotice("房间名称与章程已更新；后续 Agent 回合将使用新版本。 ");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const deleteSelectedRoom = async () => {
          if (!selectedRoom || managementBusy) return;
          const generation=roomScopeRef.current.generation;
          setManagementBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}`, {
              method: "DELETE",
              body: JSON.stringify({ expectedRevision: selectedRoom.revision ?? 1 })
            });
            setPendingRoomDelete(null);
            setInspectorMode(null);
            const active = await refreshRooms();
            if(roomScopeRef.current.generation===generation)setSelectedId(active[0]?.id ?? null);
            setNotice("房间已移入“已删除”；聊天记录和 DSH 会话仍保留，可随时恢复。");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const restoreRoom = async (room) => {
          if (!room || managementBusy) return;
          const generation=roomScopeRef.current.generation;
          setManagementBusy(true);
          try {
            const restored = await api(`/rooms/${encodeURIComponent(room.id)}/restore`, {
              method: "POST",
              body: JSON.stringify({ expectedRevision: room.revision ?? 1 })
            });
            await refreshRooms();
            if(roomScopeRef.current.generation===generation)setSelectedId(restored.id);
            setNotice(`已恢复房间「${restored.name}」。`);
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const stopRoom = async () => {
          if (!selectedRoom || managementBusy) return;
          setManagementBusy(true);
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/stop`, { method: "POST", body: "{}" });
            setRooms((list) => list.map((room) => room.id === value.id ? value : room));
            setNotice("已停止当前协作轮；迟到回复不会进入房间。 ");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const attachSession = async (sessionId, alias, ownership) => {
          await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/members`, {
            method: "POST",
            body: JSON.stringify({ sessionId, alias, ownership })
          });
          await Promise.all([refreshParticipants(), refreshRooms()]);
        };

        const createAgent = async () => {
          if (!selectedRoom || !newAgentName.trim() || creating) return;
          setCreating(true);
          setError("");
          setNotice("");
          const agentName = newAgentName.trim();
          try {
            const sessionId = String(await ctx.sessions.create(currentSummary?.cwd ? { cwd: currentSummary.cwd } : {}));
            const binding = ctx.sessions.binding?.(sessionId);
            try { await binding?.session?.rename?.(agentName); } catch { /* alias still names the room participant */ }
            await attachSession(sessionId, agentName, "provisioned");
            setNewAgentName("");
            setNotice(`已创建 DSH 会话「${agentName}」；模型、权限与工作目录由 DSH 会话管理。`);
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setCreating(false); }
        };

        const addExisting = async (sessionId) => {
          if (!selectedRoom || !sessionId || attachingSessionId) return;
          setAttachingSessionId(sessionId);
          try {
            await attachSession(sessionId, sessionLabel(sessionId), "attached");
            setNotice(`已加入现有会话「${sessionLabel(sessionId)}」；若房间内重名，会自动生成唯一 @别名。`);
            setPickerOpen(false);
            setSessionQuery("");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setAttachingSessionId(""); }
        };

        const removeMember = async (sessionId) => {
          if (!selectedRoom) return;
          try {
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/members/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
            await Promise.all([refreshParticipants(), refreshRooms()]);
            setNotice("已移出房间；原 DSH 会话未删除。");
          } catch (cause) { setError(cause.message ?? String(cause)); }
        };

        const saveMember = async () => {
          if (!selectedRoom || !editingMember?.alias?.trim() || managementBusy) return;
          setManagementBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/members`, {
              method: "POST",
              body: JSON.stringify({
                sessionId: editingMember.sessionId,
                ownership: editingMember.ownership,
                alias: editingMember.alias.trim(),
                role: editingMember.role.trim(),
                mandate: editingMember.mandate.trim(),
                expectedRevision: editingMember.roomRevision
              })
            });
            try { if(editingMember.nativeSetup?.state!=="pending")await ctx.sessions.binding?.(editingMember.sessionId)?.session?.rename?.(editingMember.alias.trim()); } catch { /* room alias remains authoritative */ }
            setEditingMember(null);
            await Promise.all([refreshParticipants(), refreshRooms()]);
            setNotice("成员名称、职务与职责已更新；下一次群聊唤醒即生效。 ");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const reorderMember = async (index, offset) => {
          if (!selectedRoom || managementBusy) return;
          const target = index + offset;
          if (target < 0 || target >= participants.length) return;
          const next = participants.map((participant) => participant.sessionId);
          [next[index], next[target]] = [next[target], next[index]];
          setManagementBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/members/order`, {
              method: "POST",
              body: JSON.stringify({ sessionIds: next, expectedRevision: selectedRoom.revision ?? 1 })
            });
            await Promise.all([refreshParticipants(), refreshRooms()]);
            setNotice("自动协作顺序已更新。 ");
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const openLedgerEditor = (entry, sourceMessage) => {
          const defaultCoordinator = participants[0];
          const kind = entry?.kind ?? "task";
          setEditingLedger({
            id: entry?.id,
            revision: entry?.revision,
            kind,
            title: entry?.title ?? (sourceMessage ? sourceMessage.text.slice(0, 120) : ""),
            details: entry?.details ?? "",
            question: entry?.question ?? "",
            decisionOptions: entry?.decisionOptions ?? [],
            relatedEntryIds: entry?.relatedEntryIds ?? [],
            acceptanceCriteria: entry?.acceptanceCriteria ?? "",
            ownerSessionId: entry?.ownerSessionId ?? "",
            reviewerSessionId: entry?.reviewerSessionId ?? "",
            status: entry?.status ?? (kind === "decision" ? "proposed" : "open"),
            dueAtInput: localDateTimeValue(entry?.dueAt),
            sourceMessageId: entry?.sourceMessageId ?? sourceMessage?.id ?? "",
            monitorEnabled: Boolean(entry?.monitor?.enabled),
            coordinatorSessionId: entry?.monitor?.coordinatorSessionId ?? defaultCoordinator?.sessionId ?? "",
            idleMinutes: entry?.monitor?.idleMinutes ?? 10
          });
        };

        const saveLedgerEntry = async () => {
          if (!selectedRoom || !editingLedger?.title?.trim() || managementBusy) return;
          if (editingLedger.kind === "task" && editingLedger.reviewerSessionId && editingLedger.reviewerSessionId === editingLedger.ownerSessionId) {
            setError("负责人不能同时验收自己的交付。请选择其他成员，或由你验收。");
            return;
          }
          const roomId = selectedRoom.id;
          setManagementBusy(true);
          try {
            const payload = {
              kind: editingLedger.kind,
              title: editingLedger.title.trim(),
              details: editingLedger.details.trim(),
              question: editingLedger.kind === "decision" ? editingLedger.question.trim() : null,
              decisionOptions: editingLedger.kind === "decision" ? editingLedger.decisionOptions : [],
              relatedEntryIds: editingLedger.relatedEntryIds,
              acceptanceCriteria: editingLedger.acceptanceCriteria.trim(),
              ownerSessionId: editingLedger.ownerSessionId || null,
              reviewerSessionId: editingLedger.kind === "task" ? editingLedger.reviewerSessionId || null : null,
              status: editingLedger.status,
              dueAt: editingLedger.dueAtInput ? new Date(editingLedger.dueAtInput).getTime() : null,
              sourceMessageId: editingLedger.sourceMessageId || undefined,
              monitor: editingLedger.kind === "task" && editingLedger.monitorEnabled ? {
                enabled: true,
                coordinatorSessionId: editingLedger.coordinatorSessionId,
                idleMinutes: Number(editingLedger.idleMinutes) || 10
              } : { enabled: false }
            };
            let savedEntry;
            if (editingLedger.id) {
              savedEntry = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/ledger/${encodeURIComponent(editingLedger.id)}`, {
                method: "POST",
                body: JSON.stringify({ patch: payload, expectedRevision: editingLedger.revision })
              });
            } else {
              savedEntry = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/ledger`, { method: "POST", body: JSON.stringify(payload) });
            }
            if (selectedIdRef.current !== roomId) return;
            setEditingLedger(null);
            setLedger(items=>[savedEntry,...items.filter(item=>item.id!==savedEntry.id)]);
            setNotice(savedEntry.kind === "decision" && savedEntry.status === "proposed" && editingLedger.status === "decided"
              ? "决定内容已变更，已退回待决定，需要重新确认；历史版本仍保留。"
              : `台账条目已${editingLedger.id ? "更新" : "登记"}，当前状态：${ledgerStatusLabel(savedEntry.status)}。${editingLedger.id ? "历史版本仍保留。" : ""}`);
            try{await Promise.all([refreshLedger(),refreshRooms()]);}catch{if(selectedIdRef.current===roomId)setError("条目已保存，但列表刷新失败；无需重复保存，请刷新台账。");}
          } catch (cause) { if (selectedIdRef.current === roomId) setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const setLedgerStatus = async (entry, status, reviewSummary, selectedOptionId, notifyParticipants = false) => {
          if (!selectedRoom || managementBusy || status === entry.status) return;
          const roomId = selectedRoom.id;
          setManagementBusy(true);
          try {
            const savedEntry = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/ledger/${encodeURIComponent(entry.id)}`, {
              method: "POST",
              body: JSON.stringify({ patch: { status, ...(reviewSummary ? { reviewSummary } : {}), ...(selectedOptionId ? { selectedOptionId } : {}), notifyParticipants }, expectedRevision: entry.revision })
            });
            if (selectedIdRef.current !== roomId) return;
            setLedger(items=>items.map(item=>item.id===savedEntry.id?savedEntry:item));
            setNotice(`「${entry.title}」已更新为${ledgerStatusLabel(savedEntry.status)}。${savedEntry.handoff?workProtocol.handoffLabel(savedEntry.handoff.state):""} 执行权限未改变。`);
            setLedgerConfirmation(ledgerConfirmation?.returnEntry?{kind:"blocked",entry:ledgerConfirmation.returnEntry,roomId}:null);
            try{await Promise.all([refreshLedger(),refreshRooms()]);}catch{if(selectedIdRef.current===roomId)setError("处理结果已保存，但列表刷新失败；无需重复确认，请刷新台账。");}
          } catch (cause) { if (selectedIdRef.current === roomId) setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const requestLedgerStatus = (entry, status, returnEntry) => {
          if (status === entry.status || managementBusy) return;
          if(status==="archived"){requestLedgerTriage(entry,"archive");return;}
          if(status==="cancelled"){setManagementDialog({entryIds:[entry.id],action:"terminate"});return;}
          if(closedLedgerStatus(entry.status)&&!closedLedgerStatus(status)){requestLedgerTriage(entry,"resume");return;}
          if(entry.status==="blocked"&&status==="in_progress"){setLedgerConfirmation({kind:"blocked",entry,roomId:selectedRoom.id});return;}
          if (["done", "decided", "resolved"].includes(status) || entry.status === "in_review") {
            setError("");
            setLedgerReviewSummary("");
            setLedgerDecisionChoice(entry.decisionOptions?.length ? "" : "adopt");
            setNotifyDecision(true);
            setLedgerConfirmation({ kind: "status", entry, status, roomId: selectedRoom.id,returnEntry });
          } else void setLedgerStatus(entry, status);
        };

        const requestLedgerTriage = (entry, action) => {
          if(managementBusy||!selectedRoom)return;
          if(action==="archive"||action==="unlink_dependency"){setLedgerConfirmation(null);setManagementDialog({entryIds:[entry.id],action});return;}
          setError("");setLedgerConfirmation({kind:"triage",entry,action,roomId:selectedRoom.id});
        };

        const ledgerTriageSaved = (savedEntry, action) => {
          const roomId=ledgerConfirmation.roomId;
          if(selectedIdRef.current!==roomId)return;
          setLedger(items=>items.map(item=>item.id===savedEntry.id?savedEntry:item));setLedgerConfirmation(null);
          setNotice(action==="show"?"已恢复历史显示，原结果保留；未完历史保持暂停，没有重新开工。":action==="resume"?"已明确重新开放，等待重新认领；没有自动重跑。":action==="dismiss_blocker"?"已忽略旧阻断；任务留在“未闭环”，未自动启动，可在条目中撤销。":action==="archive"?"事项已移除，可从“已归档 / 已移除”恢复；没有删除对话或历史。":"已恢复事项；没有自动通知成员或恢复旧提醒。");
          void Promise.all([refreshLedger(),refreshRooms()]).catch(()=>{if(selectedIdRef.current===roomId)setError("处理结果已保存，但列表刷新失败；无需重复确认，请刷新台账。");});
        };

        const openLedgerRecord = (id, filter = "all") => {
          setLedgerQuery("");
          setLedgerFilter(filter);
          setFocusedLedgerId(id ?? null);
          setInspectorMode("ledger");
        };

        const prepareRecoveryDraft = (entry, mode) => {
          if (draft.trim()) { setError("输入框已有草稿，请先发送或清空；原草稿未覆盖。"); return; }
          const creator = entry.createdBy?.startsWith("session:") ? entry.createdBy.slice(8) : null;
          const recipient = participantById.get(entry.ownerSessionId || creator);
          const nextDraft = mode === "retry" ? `请继续处理台账事项「${entry.title}」（${entry.id}）。先读取 chat_memory，使用 chat_read_document 只读读取用户已共享的 DOCX/文本，按 nextStartLine 和 expectedHash 读完对应版本；不要再使用 bash 抽取，不要重复申请同一权限。读取成功后由负责人更新进展，失败则记录实际错误、已尝试路径与具体下一步，不要仅说“工作没有停止”。`
            : mode === "clarify" ? entry.kind==="decision"?`请完善现有待决事项「${entry.title}」（${entry.id}），不要另建重复审批。写明具体 question、2–4 个 decisionOptions 及每项影响，以 relatedEntryIds 关联受阻任务。区分可直接使用的只读文档工具和真正需要在原生 DSH 会话处理的执行权限。`:`请核对现有任务「${entry.title}」（${entry.id}），不要重复建项。若仍受阻，请用 chat_work progress blocked 的 blocker 写明 kind、summary、nextStep；材料问题提供真实 filePaths，前置任务或决定提供 entryIds。先实测当前条件，不要照抄旧错误；恢复后报告 in_progress，而不是再次 acknowledge。`
              : `关于台账事项「${entry.title}」（${entry.id}），补充材料或问题：\n`;
          setDraft(nextDraft); setMentionIds(recipient ? [recipient.sessionId] : []); setMentionAll(!recipient);
          rememberRoomUi(selectedRoom.id, { draft: nextDraft, mentionIds: recipient ? [recipient.sessionId] : [], mentionAll: !recipient });
          setLedgerConfirmation(null); setInspectorMode(null); setNotice("已准备定向消息，尚未发送或唤醒成员；可补充后发送。");
          requestAnimationFrame(() => textareaRef.current?.focus());
        };

        const prepareWorkDraft = () => {
          if (draft.trim()) { setNotice("输入框已有草稿。请先发送或清空，再整理协作待办。"); return; }
          const nextDraft = "请基于本房间的公开讨论和现有协作台账，检查尚未登记的任务、待决定事项、证据及分歧，并使用房间工作工具登记或更新。已有条目请更新，不要重复新建；保留明确负责人、验收标准和原消息依据。成员自行认领并报告进展，交付只标为待验收；不得替用户拍板、验收或开启后台监控。没有实质变化就不要制造条目。";
          setDraft(nextDraft); setMentionAll(true); setMentionIds([]);
          rememberRoomUi(selectedRoom.id, { draft: nextDraft, mentionAll: true, mentionIds: [] });
          setInspectorMode(null);
          setNotice("已准备协作待办草稿，发送后开始。尚未触发 Agent。");
          requestAnimationFrame(() => textareaRef.current?.focus());
        };

        const restoreLedgerVersion = async () => {
          const target = ledgerConfirmation;
          if (!target || target.kind !== "restore" || managementBusy || selectedRoom?.id !== target.roomId) return;
          setManagementBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(target.roomId)}/ledger/${encodeURIComponent(target.entry.id)}/restore`, {
              method: "POST", body: JSON.stringify({ revision: target.event.revision, expectedRevision: target.entry.revision })
            });
            if (selectedIdRef.current !== target.roomId) return;
            await Promise.all([refreshLedger(), refreshRooms()]);
            setLedgerConfirmation(null);
            setNotice(`「${target.entry.title}」已从历史内容恢复为新版本。任务须重新认领和验收，提醒监控保持关闭。`);
          } catch (cause) { if (selectedIdRef.current === target.roomId) setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const snoozeLedger = async (entry, minutes = 10) => {
          if (!selectedRoom || managementBusy || !entry.monitor?.enabled) return;
          setManagementBusy(true);
          try {
            await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/ledger/${encodeURIComponent(entry.id)}`, {
              method: "POST",
              body: JSON.stringify({
                patch: { monitor: { ...entry.monitor, enabled: true, snoozeUntil: Date.now() + minutes * 60_000 } },
                expectedRevision: entry.revision
              })
            });
            await refreshLedger();
            setNotice(`已将「${entry.title}」的停滞提醒推迟 ${minutes} 分钟。`);
          } catch (cause) { setError(cause.message ?? String(cause)); }
          finally { setManagementBusy(false); }
        };

        const correctMessage = async () => {
          if (!selectedRoom || !correctionTarget || !correctionDraft.trim() || managementBusy) return;
          const roomId=selectedRoom.id, target=correctionTarget, text=correctionDraft.trim();
          const storageKey=`dcl:correction:${roomId}:${target.id}`;
          const key=JSON.stringify([roomId,target.id,text]);
          let operation=target.pendingCorrection;
          try { operation=JSON.parse(sessionStorage.getItem(storageKey)??"null")??operation; } catch { /* in-memory receipt remains usable */ }
          if(operation?.key!==key)operation={key,id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`};
          target.pendingCorrection=operation;
          try { sessionStorage.setItem(storageKey,JSON.stringify(operation)); } catch { /* receipt stays on this editor target */ }
          const current=()=>typeof selectedIdRef==="undefined"||selectedIdRef.current===roomId;
          setManagementBusy(true);
          try {
            const saved=await api(`/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(target.id)}/correct`, {
              method: "POST",
              body: JSON.stringify({
                text,
                clientOperationId: operation.id
              })
            });
            delete target.pendingCorrection;
            try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ }
            if(!current())return;
            setCorrectionTarget(null);
            setCorrectionDraft("");
            setMessages(list=>list.some(item=>item.id===saved.id)?list:[...list,saved]);
            setNotice("纠正已作为新消息追加；原文和通知对象均保留可查。 ");
          } catch (cause) { if(current())setError(cause.message ?? String(cause)); }
          finally { if(current())setManagementBusy(false); }
        };

        const retryFailed = async (message,options) => {
          if (!selectedRoom || retryingMessageId) return;
          if(!options&&(["full_access","workspace_write","inherit_dsh"].includes(message.actionMode)||message.actionMode!==selectedRoom.policy.defaultActionMode||message.policyRevision!==selectedRoom.policy.revision||message.deliveries?.some(delivery=>delivery.recoveryReason==="restart"))){setRetryDialog({message,operationId:crypto.randomUUID(),policyRevision:selectedRoom.policy.revision,checked:false});return;}
          const roomId=selectedRoom.id;
          setRetryingMessageId(message.id);
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/messages/${encodeURIComponent(message.id)}/retry`, { method: "POST", body: JSON.stringify(options??{}) });
            if(selectedIdRef.current!==roomId)return;
            setRetryDialog(null);
            setNotice(options?.mode==="current"?"已按当前权限建立接续记录，只通知原先失败的成员；请核对已有结果，不重复成功工作。":`已只重试 ${value.retriedSessionIds.length} 个失败参与者；原消息没有重复写入。`);
            void api(`/rooms/${encodeURIComponent(roomId)}/messages?limit=200`).then(next=>{if(selectedIdRef.current===roomId)setMessages(next);}).catch(()=>setRoomListError("接续已保存，消息列表暂未同步。"));
          } catch (cause) { if(selectedIdRef.current===roomId)setError(cause.message ?? String(cause)); }
          finally { if(selectedIdRef.current===roomId)setRetryingMessageId(""); }
        };

        const runSearch = async () => {
          if (!selectedRoom || searchBusy) return;
          const requestRoomId=selectedRoom.id;
          setSearchBusy(true);
          try {
            const parameters = new URLSearchParams();
            if (searchQuery.trim()) parameters.set("q", searchQuery.trim());
            if (searchAuthor) parameters.set("author", searchAuthor);
            if (searchDeliveryStatus) parameters.set("deliveryStatus", searchDeliveryStatus);
            parameters.set("limit", "200");
            const value=await api(`/rooms/${encodeURIComponent(requestRoomId)}/search?${parameters.toString()}`);
            if(selectedIdRef.current===requestRoomId)setSearchResults(value);
          } catch (cause) { if(selectedIdRef.current===requestRoomId)setError(cause.message ?? String(cause)); }
          finally { setSearchBusy(false); }
        };

        const jumpToMessage = async (messageId) => {
          if (!selectedRoom) return;
          const requestRoomId = selectedRoom.id;
          try {
            if (!messages.some((message) => message.id === messageId)) {
              const context = await api(`/rooms/${encodeURIComponent(requestRoomId)}/messages/${encodeURIComponent(messageId)}/context?radius=30`);
              if (selectedIdRef.current !== requestRoomId) return;
              historyModeRef.current = true;
              setHistoryMode(true);
              setMessages(context);
            }
            atBottomRef.current = false;
            setInspectorMode(null);
            setHighlightedMessageId(messageId);
            setTimeout(() => document.getElementById(`dcl-message-${messageId}`)?.scrollIntoView?.({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 40);
          } catch (cause) { if (selectedIdRef.current === requestRoomId) setError(cause.message ?? String(cause)); }
        };

        React.useEffect(()=>{
          const target=sourceJumpRef.current;
          if(target&&target.roomId===selectedId&&selectedRoom){sourceJumpRef.current=null;void jumpToMessage(target.messageId);}
        },[selectedId,selectedRoom?.id]);

        const returnToLatest = async () => {
          if (!selectedRoom) return;
          const requestRoomId = selectedRoom.id;
          try {
            const latest = await api(`/rooms/${encodeURIComponent(requestRoomId)}/messages?limit=200`);
            if (selectedIdRef.current !== requestRoomId) return;
            historyModeRef.current = false;
            setHistoryMode(false);
            setMessages(latest);
            queueMicrotask(jumpToLatest);
          } catch (cause) { if (selectedIdRef.current === requestRoomId) setError(cause.message ?? String(cause)); }
        };

        const openSession = async (participant) => {
          try { if(participant.nativeSetup?.state==="pending")await prepareParticipant(participant);await ctx.sessions.open(participant.sessionId); props?.onClose?.(); }
          catch (cause) { setError(cause.message ?? String(cause)); }
        };

        const toggleMention = (sessionId) => {
          setMentionAll(false);
          setMentionIds((value) => {
            const next = value.includes(sessionId) ? value.filter((id) => id !== sessionId) : [...value, sessionId];
            rememberRoomUi(selectedRoom?.id, { mentionAll: false, mentionIds: next });
            return next;
          });
        };

        const send = async () => {
          if (!selectedRoom || !draft.trim() || sending) return;
          setHistoryMode(false);
          historyModeRef.current = false;
          const requestRoomId = selectedRoom.id;
          const requestText = draft.trim();
          const requestMentions = mentionAll ? ["all"] : [...mentionIds];
          const key=JSON.stringify([requestText,[...requestMentions].sort()]);
          let pending=pendingSends.current.get(requestRoomId);
          if(!pending||pending.key!==key){pending={key,id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,text:requestText,mentions:requestMentions};pendingSends.current.set(requestRoomId,pending);}
          try {sessionStorage.setItem(`dcl:pending:${requestRoomId}`,JSON.stringify(pending));}catch{/* in-memory id remains reusable */}
          setSending(true);
          setError("");
          rememberRoomUi(requestRoomId, { draft: "", mentionAll: false, mentionIds: [] });
          setDraft("");
          setMentionAll(false);
          setMentionIds([]);
          try {
            const saved=await api(`/rooms/${encodeURIComponent(requestRoomId)}/messages`, {
              method: "POST",
              body: JSON.stringify({
                author: HUMAN_ID,
                authorKind: "human",
                authorAlias: "我",
                text: requestText,
                mentions: requestMentions,
                clientOperationId: pending.id
              })
            });
            pendingSends.current.delete(requestRoomId);
            try {sessionStorage.removeItem(`dcl:pending:${requestRoomId}`);}catch{}
            if(selectedIdRef.current===requestRoomId){
              setMessages(current=>current.some(m=>m.id===saved.id)?current:[...current,saved].slice(-200));
              setNotice(saved.scheduledCount?`消息已保存，已安排 ${saved.scheduledCount} 位成员。`:"消息已保存到房间。");
            }
          } catch (cause) {
            const currentDraft=selectedIdRef.current===requestRoomId?draftRef.current:roomUiRef.current.get(requestRoomId)?.draft;
            const noNewDraft=!currentDraft?.trim()||currentDraft.trim()===requestText;
            if(noNewDraft)rememberRoomUi(requestRoomId, { draft: requestText, mentionAll: requestMentions.includes("all"), mentionIds: requestMentions.includes("all") ? [] : requestMentions });
            if (selectedIdRef.current === requestRoomId && noNewDraft) {
              setDraft(requestText);
              setMentionAll(requestMentions.includes("all"));
              setMentionIds(requestMentions.includes("all") ? [] : requestMentions);
              setError(`未收到保存确认，草稿已保留；直接重试会沿用同一发送编号。${cause.message ?? String(cause)}`);
            }else if(selectedIdRef.current===requestRoomId){
              setError(`上一条消息未收到保存确认；你正在写的新草稿未被覆盖。失败原文：${requestText}`);
            }
          }
          finally { setSending(false); }
        };

        const previewArtifact = async (reference, message) => {
          if (!selectedRoom || !reference) return;
          const requestRoomId=selectedRoom.id, request=++previewRequest.current;
          setPreviewLoading(true);
          setError("");
          setInspectorMode("artifact");
          setPreview({ logicalName: reference, loading: true });
          try {
            const value = await api(`/rooms/${encodeURIComponent(selectedRoom.id)}/artifacts/preview`, {
              method: "POST",
              body: JSON.stringify({
                path: reference,
                ...(message?.authorKind === "session" && message.author && sessionIds.includes(String(message.author)) ? { sessionId: message.author } : {})
              })
            });
            if(selectedIdRef.current!==requestRoomId||previewRequest.current!==request)return;
            setPreview(value);
          } catch (cause) {
            if(selectedIdRef.current===requestRoomId&&previewRequest.current===request)setPreview({ logicalName: reference, error: artifactFailureMessage(cause),
              ...(cause.code === "FILE_REFERENCE_AMBIGUOUS" && cause.candidates?.length ? { candidates: cause.candidates } : {}) });
          } finally { if(selectedIdRef.current===requestRoomId&&previewRequest.current===request)setPreviewLoading(false); }
        };

        const exportRoom = async format => {
          if(!selectedRoom||exporting)return;setExporting(true);
          const roomId=selectedRoom.id;
          try {
            const value=await api(`/rooms/${encodeURIComponent(roomId)}/export`,{method:"POST",body:JSON.stringify({format})});
            if(selectedIdRef.current===roomId){setSavedExport(value);setNotice("导出文件已保存到本机，路径显示在“导出与备份”区域。");}
          }catch(cause){if(selectedIdRef.current===roomId)setError(cause.message??String(cause));}finally{setExporting(false);}
        };
        const copyMessage = async text => {
          try { await navigator.clipboard.writeText(text);setNotice("已复制消息原文（保留 Markdown）。"); }
          catch { setError("剪贴板不可用，请选中消息内容手动复制。"); }
        };
        const prepareContinuation = () => {
          if(draft.trim()){setNotice("已有草稿，未覆盖；请先处理当前草稿。");return;}
          const ids=(selectedRoom.orchestration?.pendingSessionIds??[]).filter(id=>participants.some(p=>p.sessionId===id));
          const tasks=ledger.filter(entry=>entry.kind==="task"&&!closedLedgerStatus(entry.status)&&(!ids.length||ids.includes(entry.status==="in_review"?entry.reviewerSessionId:entry.ownerSessionId)));
          const text=`请读取共享台账与上一轮结果，继续以下范围：\n${tasks.length?tasks.map(entry=>`- ${entry.status==="in_review"?"独立验收":"推进"}「${entry.title}」(${entry.id})；核对现有交付，不重复执行。`).join("\n"):"核对本轮尚未回应的事项，先说明具体下一步。"}\n遇到阻断请报告实际错误与可执行的处理方式；不得把回合结束当作任务完成，或重复完成已验收的任务。`;
          setDraft(text);setMentionIds(ids);setMentionAll(!ids.length);rememberRoomUi(selectedRoom.id,{draft:text,mentionIds:ids,mentionAll:!ids.length});
          setNotice("继续消息已准备，发送后才会启动下一轮。");textareaRef.current?.focus();
        };

        const onTimelineScroll = (event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
          atBottomRef.current = atBottom;
          if (atBottom) setNewMessageCount(0);
        };

        const jumpToLatest = () => {
          const element = timelineRef.current;
          if (element) element.scrollTop = element.scrollHeight;
          atBottomRef.current = true;
          setNewMessageCount(0);
        };

        const participantById = new Map(participants.map((item) => [item.sessionId, item]));
        const openLedger = ledger.filter((entry) => !closedLedgerStatus(entry.status));
        const actionableLedger=openLedger.filter(entry=>entry.kind!=="evidence");
        const openTasks=openLedger.filter(entry=>entry.kind==="task");
        const evidenceCount=ledger.filter(entry=>entry.kind==="evidence"&&!closedLedgerStatus(entry.status)).length;
        const needsUserCount = ledger.filter((entry) => ledgerNeedsUser(entry, participantById)).length;
        const blockedWorkCount = openLedger.filter((entry) => entry.status === "blocked").length;
        const inReviewWorkCount = openLedger.filter((entry) => entry.status === "in_review").length;
        const filteredLedger = ledger.filter((entry) => ledgerFilter === "all" ? true
          : ledgerFilter === "mine" ? ledgerNeedsUser(entry, participantById)
            : ledgerFilter === "open" ? !closedLedgerStatus(entry.status)
              : ledgerFilter === "blocked" ? entry.status === "blocked"
                : ledgerFilter === "archived" ? entry.status === "archived"
                : ledgerFilter === "in_review" ? entry.status === "in_review"
                  : entry.kind === ledgerFilter && entry.status !== "archived").filter(entry=>!ledgerQuery.trim()||[entry.title,entry.details,entry.progress?.summary,entry.blocker?.nextStep,participantById.get(entry.ownerSessionId)?.alias].filter(Boolean).join("\n").toLocaleLowerCase().includes(ledgerQuery.trim().toLocaleLowerCase()));
        const messageById = new Map(messages.map((item) => [item.id, item]));
        const correctionByTarget = new Map(messages.filter((item) => item.correctsMessageId).map((item) => [item.correctsMessageId, item]));
        const mentionLabel = (mention) => {
          if (mention === "all") return "@全部";
          if (!mention.startsWith("session:")) return `@${mention}`;
          const id = decodeURIComponent(mention.slice("session:".length));
          return `@${participantById.get(id)?.alias ?? id.slice(0, 8)}`;
        };
        const runningParticipants = participants.filter((item) => ["running", "waking"].includes(item.runtime?.state)).length;
        const unknownPermissions=participants.filter(item=>!item.nativePermission&&item.nativeSetup?.state!=="pending").length;
        const targetPreset=selectedRoom?.policy?.defaultActionMode==="full_access"?"danger-full-access":selectedRoom?.policy?.defaultActionMode==="workspace_write"?"workspace-write":null;
        const differentPermissions=targetPreset?participants.filter(item=>item.nativePermission&&item.nativePermission!==targetPreset).length:0;
        const inlineMentions=textProtocol.mentions(draft,participants);
        const inlineMentionAll = inlineMentions.includes("all");
        const inlineMentionIds = participants.filter(participant=>inlineMentions.includes(`session:${encodeURIComponent(participant.sessionId)}`)).map(participant=>participant.sessionId);
        const effectiveMentionIds = [...new Set([...mentionIds, ...inlineMentionIds])];
        const audience = mentionAll || inlineMentionAll
          ? `将点名全部 ${participants.length} 个参与者`
          : effectiveMentionIds.length > 0
            ? `将点名 ${effectiveMentionIds.map((id) => participantById.get(id)?.alias ?? id.slice(0, 8)).join("、")}${inlineMentionIds.length ? "（含正文 @）" : ""}`
            : selectedRoom?.autoDeliver
              ? `自动协作：先依次询问 ${participants.length} 个参与者；Agent 的 @ 会继续路由对话`
              : "仅记录到房间，不唤醒 Agent";

        const inspectorButton = (mode, icon, label, ariaLabel, onClick) => h("button", {
          className: "dclToolButton",
          onClick: onClick ?? (() => setInspectorMode(inspectorMode === mode ? null : mode)),
          "aria-expanded": inspectorMode === mode, "aria-controls": "dcl-inspector", title: label, "aria-label": ariaLabel ?? label
        }, lineIcon(icon), h("span", { className: "dclToolLabel" }, label), mode === "ledger" && actionableLedger.length
          ? h("span", { className: "dclToolCount", title: `${actionableLedger.length} 项待推进（不含证据）` }, actionableLedger.length) : null);

        const groupHeader = h("header", { className: "dclHeader" },
          h("div", { className: "dclHeaderTop" },
          h("div", { className: "dclNavControls" },
            h("button", {
              ref: props?.entryFocusRef,
              className: "dclIconButton dclBackButton",
              onClick: props?.onClose,
              title: "返回 DSH 主页面",
              "aria-label": "返回 DSH 主页面"
            }, lineIcon("arrow-left"), h("span", { className: "dclBackLabel" }, "DSH")),
            h("button", {
              className: "dclIconButton",
              onClick: () => setRoomSidebarOpen((value) => !value),
              title: roomSidebarOpen ? "收起群聊侧栏" : "展开群聊侧栏",
              "aria-label": roomSidebarOpen ? "收起群聊侧栏" : "展开群聊侧栏",
              "aria-controls": "dcl-room-sidebar",
              "aria-expanded": roomSidebarOpen
            }, lineIcon(roomSidebarOpen ? "sidebar-close" : "sidebar-open"))
            ,!roomSidebarOpen?h("button",{className:"dclIconButton",disabled:conversationBusy,onClick:()=>void openWorkspace(),"aria-label":"新建独立对话",title:"选择本次阵容，开始新议题"},lineIcon("edit")):null
          ),
          h("div", { className: "dclHeaderIntro" },
            h("h2", { className: "dclHeaderName" }, selectedRoom?.name ?? "群聊"),
            h("div", { className: "dclHeaderMode" }, selectedRoom
              ? `${selectedGroup?.name??"群组"} · ${selectedRoom.members?.length??participants.length} 位参与者 · ${selectedRoom.autoDeliver ? "自动协作" : "按需 @"}`
              : "选择或新建一个对话")
          ),
          selectedRoom ? h("div", { className: "dclHeaderTools", "aria-label": "房间工具" },
            inspectorButton("search", "search", "搜索", "搜索群聊", () => {
              if (inspectorMode === "search") setInspectorMode(null);
              else { setInspectorMode("search"); void runSearch(); }
            }),
            inspectorButton("ledger", "ledger", "台账", "协作台账"),
            inspectorButton("participants", "users", "参与者"),
            inspectorButton("profile", "book", selectedRoom?.pendingCharterCount ? `章程 · ${selectedRoom.pendingCharterCount}` : "章程", "房间章程"),
            inspectorButton("settings", "settings", "设置", "房间设置", () => inspectorMode === "settings" ? setInspectorMode(null) : openRoomSettings())
          ) : null
          ),
          selectedRoom ? h("div", { className: "dclRoomToolbar" },
            h("button", { className: "dclSwitch", role: "switch", "aria-checked": Boolean(selectedRoom.autoDeliver), disabled: settingsBusy, onClick: () => void toggleAuto(), title: selectedRoom.autoDeliver ? "自动协作已开启；点击改为仅 @点名" : "点击开启自动协作", "aria-label": "自动协作" },
              h("span", { className: "dclSwitchTrack", "aria-hidden": true }), settingsBusy ? "更新中…" : "自动协作"),
            h("div", { className: "dclPolicy", title: "实际权限与会话影响" },
              h("button", {className:"dclPolicyDetails","aria-label":"查看房间权限设置",disabled:settingsBusy,onClick:()=>requestPolicy(selectedRoom.policy?.defaultActionMode??"discuss_only",undefined,true)},lineIcon("shield")),
              h("select", {
                className: "dclPolicySelect",
                value: selectedRoom.policy?.defaultActionMode ?? "discuss_only",
                onChange: (event) => requestPolicy(event.target.value),
                disabled: settingsBusy || roomCollaborationActive,
                "aria-label": "房间权限策略"
              },
                h("option", { value: "discuss_only" }, "讨论 · 文件只读"),
                h("option", { value: "read_only_audit" }, "只读审计"),
                h("option", { value: "inherit_dsh" }, "跟随 DSH"),
                h("option", { value: "workspace_write" }, "工作区内修改"),
                h("option", { value: "full_access" }, "完全权限")
              )
            ),
            h("span", { className: "dclRoomState" }, h("span", { className: `dclStatusDot${roomCollaborationActive ? " live" : ""}` }), roomCollaborationActive ? `${runningParticipants || ""} 位成员协作中` : "等待新议题"),
            unknownPermissions||differentPermissions?h("button",{className:"dclMiniButton",onClick:()=>setInspectorMode("participants"),title:"房间策略不等于每位成员当前的原生权限；未读取不代表已放权。"},unknownPermissions?`原生权限待核对 ${unknownPermissions}`:`权限与策略不同 ${differentPermissions}`):null,
            needsUserCount || blockedWorkCount || inReviewWorkCount ? h("div", { className: "dclWorkSummary", "aria-label": "协作待办概览" },
              needsUserCount ? h("button", { className: "attention", onClick: () => openLedgerRecord(null, "mine") }, `待我处理 ${needsUserCount}`) : null,
              blockedWorkCount ? h("button", { className: "attention", onClick: () => openLedgerRecord(null, "blocked") }, `受阻 ${blockedWorkCount}`) : null,
              inReviewWorkCount ? h("button", { onClick: () => openLedgerRecord(null, "in_review") }, `待验收 ${inReviewWorkCount}`) : null) : null,
            ["queued", "running"].includes(selectedRoom.orchestration?.state) ? h("button", {
              className: "dclDanger", style: { height: 28, padding: "0 9px" }, disabled: managementBusy, onClick: () => void stopRoom(), title: "停止当前协作轮并忽略迟到回复"
            }, "停止") : null
          ) : null
        );

        const containLayerFocus = (event) => {
          if(event.target.closest?.('.dclTeamDialog'))return;
          if (event.key !== "Tab") return;
          const root = workspaceRef.current;
          const layer = root?.querySelector('.dclModelDialog') ?? root?.querySelector('.dclPicker')
            ?? (inspectorMode && overlayInspector ? root?.querySelector('.dclInspector') : null)
            ?? (compactWorkspace && roomSidebarOpen ? root?.querySelector('.dclSide') : null);
          if (!layer) return;
          const controls = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')].filter((element) => element.getClientRects().length);
          if (!controls.length) return;
          const first = controls[0], last = controls.at(-1);
          if (!layer.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        };

        return h("div", { ref: workspaceRef, onKeyDownCapture: containLayerFocus, className: `dclBody${roomSidebarOpen ? "" : " dclRoomSideClosed"}` },
          compactWorkspace && roomSidebarOpen ? h("button", { className: "dclScrim dclSidebarScrim", onClick: () => setRoomSidebarOpen(false), "aria-label": "关闭群聊侧栏", tabIndex: -1 }) : null,
          h("aside", { id: "dcl-room-sidebar", className: "dclSide",role:compactWorkspace&&roomSidebarOpen?"dialog":undefined,"aria-modal":compactWorkspace&&roomSidebarOpen?true:undefined,"aria-label": "群组与对话" },
            h("div", { className: "dclSideHead" },
              h("div", { className: "dclSideIdentity" },
                h("span", { className: "dclSideMark" }, lineIcon("chat")),
                h("div", null, h("div", { className: "dclTitle" }, "群聊"), h("div", { className: "dclSideHint" }, "团队协作空间"))
              ),
              h("button", { className: "dclIconButton dclSideDismiss", onClick: () => setRoomSidebarOpen(false), "aria-label": "收起房间导航" }, lineIcon("close"))
            ),
            h("nav",{className:"dclGlobalNav","aria-label":"群聊工作區導航"},h("button",{className:topPage==="groups"?"active":"",onClick:()=>openHome("groups"),"aria-current":topPage==="groups"?"page":undefined},lineIcon("users"),"群組"),h("button",{className:topPage==="agents"?"active":"",onClick:()=>openHome("agents"),"aria-current":topPage==="agents"?"page":undefined},lineIcon("user"),"Agent")),
            topPage||workspaceDraft?.kind==="group"||groupSettings?h("div",{className:"dclHomeSide"},h("button",{className:"dclNewRoom",onClick:openGroupComposer},lineIcon("plus"),"建立群組"),h("p",{className:"dclAgentMeta"},"群組保存團隊；每段對話有獨立的工作進度。"),h("div",{className:"dclGroupLabel"},"最近群組"),groups.filter(g=>!g.archivedAt&&!g.deletedAt).sort((a,b)=>Number(Boolean(b.pinnedAt))-Number(Boolean(a.pinnedAt))||(b.lastActivityAt??b.updatedAt??b.createdAt??0)-(a.lastActivityAt??a.updatedAt??a.createdAt??0)).slice(0,6).map(g=>h("button",{key:g.id,className:"dclRowButton",onClick:()=>chooseGroup(g.id)},g.name))):h(React.Fragment,null,
            h("div",{className:"dclGroupLabel"},h("span",null,"目前群組"),h("button",{className:"dclIconButton",onClick:()=>selectedGroup&&openGroupSettings(selectedGroup),"aria-label":"群組成員與預設",title:"只調整未來對話"},lineIcon("settings")),h("button",{className:"dclIconButton",onClick:openGroupComposer,disabled:creatingRoom,"aria-label":"新建群组",title:"新建另一支团队"},lineIcon("plus"))),
            h(GroupSwitcher,{groups,selected:selectedGroup,onSelect:chooseGroup,onCreate:openGroupComposer,onManage:()=>openHome("groups"),disabled:creatingRoom}),
            h("button",{className:"dclNewRoom",disabled:conversationBusy||!!selectedGroup?.archivedAt,"aria-busy":conversationBusy,onClick:()=>void openWorkspace(),title:"先寫內容，沿用群組預選或調整本次參與者"},lineIcon("edit"),conversationBusy?"正在打開…":"新對話"),
            workspaceData.drafts.filter(draft=>draft.kind==="conversation"&&draft.groupId===(selectedGroup?.id??null)).map(item=>h("button",{key:item.id,className:"dclRowButton dclDraftRow",onClick:()=>void resumeWorkspace(item)},`草稿 · ${item.title||item.text?.slice(0,25)||"尚未命名"}`)),
            h("div", { className: "dclRoomSection" }, h("span", null, "对话",h("small",null,groupRooms.length)),h("button",{className:"dclIconButton","aria-label":"查找对话","aria-expanded":conversationSearchOpen,"aria-controls":"dcl-conversation-search",onClick:()=>{setConversationSearchOpen(value=>!value);setConversationQuery("");}},lineIcon("search"))),
            conversationSearchOpen?h("div",{className:"dclConversationSearch",id:"dcl-conversation-search"},h("input",{className:"dclInput",autoFocus:true,value:conversationQuery,onChange:event=>setConversationQuery(event.target.value),"aria-label":"搜索当前群组的对话",placeholder:"搜索对话名称…",onKeyDown:event=>{if(event.key==="Escape"){event.stopPropagation();setConversationSearchOpen(false);setConversationQuery("");workspaceRef.current?.querySelector('[aria-label="查找对话"]')?.focus();}}})):null,
            h("div", {"aria-label":"当前群组的对话"},
              visibleGroupRooms.length === 0 ? h("div", { className: "dclEmpty",role:"status" }, roomsLoading ? "加载中…" : conversationQuery.trim()?h(React.Fragment,null,"没有匹配的对话",h("button",{className:"dclMiniButton",style:{display:"block",margin:"8px auto 0"},onClick:()=>setConversationQuery("")},"清除搜索")):"还没有对话，点击上方新对话") : visibleGroupRooms.map((room) =>
                h("button", { key: room.id, className: "dclRowButton" + (selectedId === room.id&&!workspaceDraft ? " dclRowActive" : ""), onClick: () => { closeWorkspace();setTopPage(null);setSelectedId(room.id); if (compactWorkspace) setRoomSidebarOpen(false); }, "aria-current": selectedId === room.id&&!workspaceDraft ? "page" : undefined, title: room.name },
                  h("div", { className: "dclRoomName" }, lineIcon("chat"), h("span", null, room.name)),
                  h("div", { className: "dclRoomMeta" },
                    h("span", null, (room.messageCount??0)?`${room.messageCount} 条消息`:"尚未开始"),
                    ["running","queued"].includes(room.orchestration?.state) ? h("span", { className: "dclRoomRunning" }, "协作中") : room.workSummary?.actionable ? h("span",null,`${room.workSummary.actionable} 项待推进`) : null
                  )
                )
              )
            ),
            groupTrash.length ? h("details", { className: "dclTrash" },
              h("summary", null, `已删除对话 · ${groupTrash.length}`),
              groupTrash.map((room) => h("div", { key: room.id, className: "dclTrashRow" },
                h("span", { className: "dclTrashName", title: `${groups.find(group=>group.id===room.groupId)?.name??"群组"} · ${room.name}` }, room.name),
                h("button", { className: "dclMiniButton", disabled: managementBusy, onClick: () => void restoreRoom(room) }, "恢复")
              ))
            ) : null)
          ),
          topPage||groupSettings?h("main",{className:"dclMain dclManagementMain"},h("div",{className:"dclHeader dclManagementHeader"},h("button",{className:"dclIconButton","aria-label":"返回 DSH 主页面",onClick:props?.onClose},lineIcon("arrow-left")),h("button",{className:"dclIconButton","aria-label":"展开或收起群聊侧栏",onClick:()=>setRoomSidebarOpen(!roomSidebarOpen)},lineIcon("sidebar")),h("strong",null,groupSettings?"群組 / "+groupSettings.name:topPage==="agents"?"Agent 名冊":"群組")),roomListError?h("div",{className:"dclError",role:"alert"},roomListError):null,groupSettings?h(GroupUI.GroupSettings,{key:groupSettings.id,group:groupSettings,onClose:()=>openHome("groups"),onSaved:group=>{setGroups(list=>list.map(g=>g.id===group.id?{...g,...group}:g));setGroupSettings({...groupSettings,...group});void refreshRooms().catch(()=>{});}}):topPage==="agents"?h(TeamUI.AgentLibrary,{onChanged:()=>void refreshRooms().catch(()=>{})}):h(GroupUI.GroupHome,{groups,drafts:workspaceData.drafts,onOpenGroup:chooseGroup,onNewGroup:openGroupComposer,onNewConversation:()=>void openWorkspace("conversation",true,null),onDraft:resumeWorkspace,onSettings:openGroupSettings,onRefresh:refreshRooms})):null,
          workspaceDraft?h("main",{className:"dclMain"},h("div",{className:"dclHeader dclManagementHeader"},h("button",{className:"dclIconButton","aria-label":"返回 DSH 主页面",onClick:props?.onClose},lineIcon("arrow-left")),h("button",{className:"dclIconButton","aria-label":"展开或收起群聊侧栏",onClick:()=>setRoomSidebarOpen(!roomSidebarOpen)},lineIcon("sidebar")),h("strong",null,workspaceDraft.kind==="group"?"群組 / 建立群組":groups.find(group=>group.id===workspaceDraft.groupId)?.name??"臨時討論")),h(WorkspaceComposer,{key:workspaceDraft.id,initial:workspaceDraft,navigationToken:workspaceRequest.current,rosters:workspaceData.rosters,groups,onClose:closeWorkspace,onComplete:completeWorkspace,onRosterSaved:roster=>setWorkspaceData(data=>({...data,rosters:[...data.rosters.filter(item=>item.id!==roster.id),roster]})),onDraftSaved:draft=>setWorkspaceData(data=>({...data,drafts:[...data.drafts.filter(item=>item.id!==draft.id),draft]}))})):null,
          h("main", { className: "dclMain",style:workspaceDraft?{display:"none"}:topPage||groupSettings?{display:"none"}:undefined },
            groupHeader,
            backgroundRooms.length?h("div",{className:"dclBackgroundConversations",role:"status"},h("span",null,"其他对话仍在协作："),backgroundRooms.map(room=>h("button",{key:room.id,className:"dclMiniButton",onClick:()=>{setGroupChoice(room.groupId);setSelectedId(room.id);}},`${room.name} →`))):null,
            error || syncError || roomListError ? h("div", { className: "dclError", role: "alert" }, h("span", null, error || syncError || roomListError), error ? h("button", { className: "dclClose", onClick: () => setError(""), "aria-label": "关闭错误提示" }, lineIcon("close")) : null) : null,
            notice ? h("div", { className: "dclNotice", role: "status" },
              h("span", null, notice),
              h("button", { className: "dclNoticeDismiss", onClick: () => setNotice(""), "aria-label": "关闭通知" }, "×")
            ) : null,
            !selectedRoom ? h("div", { className: "dclConversationWelcome", style: { margin: "auto" } }, roomsLoading ? "正在加载群聊…" : h(React.Fragment,null,h("div",{className:"dclWelcomeMark"},lineIcon("users")),h("h3",null,selectedGroup?"开启一段新的对话":"先开始讨论，团队可以逐步建立"),h("p",null,"选择本次参与者，草稿会保存。无需先建立成员库或填写章程。"),h("button",{className:"dclPrimary",disabled:conversationBusy,onClick:()=>void openWorkspace()},"新对话"),h("button",{className:"dclSecondary",onClick:openGroupComposer},"建立群组"))) :
              h(React.Fragment, null,
                selectedRoom.origin?h("details",{className:"dclConversationOrigin"},h("summary",null,`分支背景 · ${selectedRoom.origin.roomName}`),
                  h("p",null,"仅引用以下选定消息，不继承活动任务、材料授权或旧结论的有效性。"),
                  selectedRoom.origin.messages.map(message=>h("blockquote",{key:message.id},h("strong",null,message.author),h("p",null,message.text))),
                  selectedRoom.origin.background?h("p",null,selectedRoom.origin.background):null,
                  h("button",{className:"dclSecondary",disabled:!rooms.some(room=>room.id===selectedRoom.origin.roomId),onClick:()=>{sourceJumpRef.current={roomId:selectedRoom.origin.roomId,messageId:selectedRoom.origin.messages[0].id};setSelectedId(selectedRoom.origin.roomId);}},rooms.some(room=>room.id===selectedRoom.origin.roomId)?"返回来源消息":"来源对话已删除，可在侧栏恢复")) : null,
                selectedRoom.orchestration && (["failed","interrupted"].includes(selectedRoom.orchestration.state)||["reply_limit","member_limit","delivery_failed"].includes(selectedRoom.orchestration.endReason)) ? h("section",{className:"dclRoundStatus","aria-label":"协作回合状态"},
                  h("strong",null,selectedRoom.orchestration.endReason==="restart"?"上次协作被重启中断":selectedRoom.orchestration.endReason==="reply_limit"?"本轮已到自动回复上限":selectedRoom.orchestration.endReason==="member_limit"?"部分成员已到本轮发言上限":"本轮存在未成功的投递"),
                  h("p",null,selectedRoom.orchestration.error??"回合结束不等于任务完成。已有消息和台账已保留，可核对结果后继续；不会自动重复执行。"),
                  h("p",null,`待继续：${(selectedRoom.orchestration.pendingSessionIds??[]).map(id=>participantById.get(id)?.alias??"已离开成员").join("、")||"请先核对未闭环事项"}。准备后可在输入框确认收件人与具体任务。`),
                  h("details",null,h("summary",null,"查看本轮次数与重置规则"),selectedRoom.orchestration.budget?h("p",null,`已回复 ${selectedRoom.orchestration.budget.visibleReplies}/${selectedRoom.orchestration.budget.maxReplies}；`+participants.map(p=>`${p.alias} ${selectedRoom.orchestration.budget.turnsByMember?.[p.sessionId]??0}/${selectedRoom.orchestration.budget.maxTurnsPerParticipant}`).join(" · ")):h("p",null,"此历史回合未保存逐人次数；新回合开始后显示实际次数。"),h("p",null,"每次唤醒计 1 次（含跳过和失败）；发送新的协作任务才重置。刷新页面、切换房间不会重置；自动协作不会无限续轮。")),
                  h("div",{className:"dclRoundActions"},h("button",{className:"dclMiniButton",onClick:prepareContinuation,disabled:roomCollaborationActive},"准备继续…"),selectedRoom.orchestration.rootMessageId?h("button",{className:"dclMiniButton",onClick:()=>jumpToMessage(selectedRoom.orchestration.rootMessageId)},"查看原任务 / 失败投递"):null,h("button",{className:"dclMiniButton",onClick:()=>openLedgerRecord(null,"open")},"核对未闭环事项"))) : null,
                historyMode ? h("div", { className: "dclNotice", role: "status", style: { paddingBottom: 6 } },
                  h("span", null, "正在查看历史片段；实时新消息暂不改变当前位置。"),
                  h("button", { className: "dclSecondary", style: { height: 28 }, onClick: () => void returnToLatest() }, "返回最新")
                ) : null,
                h("div", { className: "dclTimelineWrap" },
                  h("section", { className: "dclTimeline", ref: timelineRef, role: "log", "aria-label": `${selectedRoom.name} 的群聊消息`, "aria-live": "off", "aria-relevant": "additions", onScroll: onTimelineScroll },
                    h("div", { className: "dclThread" },
                      messages.length === 0 ? (selectedRoom.messageCount>0?h("div",{className:"dclEmpty",role:"status"},"正在加载对话…"):h(React.Fragment, null,
                        selectedRoom.profile?.purpose ? h("div", { className: "dclBriefCard" },
                          h("div", { className: "dclBriefEyebrow" }, "合作聊天室已就绪"),
                          h("p", { className: "dclBriefPurpose" }, selectedRoom.profile.purpose),
                          h("button", { className: "dclAgentBtn", style: { marginTop: 7, padding: 0 }, onClick: () => setInspectorMode("profile") }, "查看章程与职责 →")
                        ) : null,
                        h(ConversationWelcome,{room:selectedRoom,members:participants.length?participants:(selectedRoom.members??[]),onParticipants:()=>setInspectorMode("participants"),onCompose:()=>textareaRef.current?.focus()})
                      )) : messages.map((message, index) => {
                        const references = artifactReferences(message.text);
                        const human = message.authorKind === "human";
                        const system = message.authorKind === "system";
                        const participant = human || system ? null : participantById.get(message.author);
                        const alias = human ? "我" : (message.authorAlias ?? participant?.alias ?? (system ? "系统" : message.author.slice(0, 8)));
                        const cause = message.causedByMessageId ? messageById.get(message.causedByMessageId) : null;
                        const causeAlias = cause ? (cause.authorKind === "human" ? "我" : (cause.authorAlias ?? participantById.get(cause.author)?.alias ?? "上一位 Agent")) : null;
                        const correction = correctionByTarget.get(message.id);
                        const corrected = message.correctsMessageId ? messageById.get(message.correctsMessageId) : null;
                        const accent = agentAccent(participant?.memberId??message.author);
                        const deliveryText = deliverySummary(message.deliveries);
                        const failedDeliveries = message.deliveries?.filter((delivery) => delivery.status === "failed") ?? [];
                        const startsDay = index === 0 || new Date(messages[index - 1].sentAt).toDateString() !== new Date(message.sentAt).toDateString();
                        return h(React.Fragment, { key: message.id },
                          startsDay ? h("div", { className: "dclDateDivider" }, messageDayLabel(message.sentAt)) : null,
                          h("article", {
                          id: `dcl-message-${message.id}`,
                          className: `dclMsg${human ? " human" : ""}${system ? " system" : ""}${cause ? " causal" : ""}${highlightedMessageId === message.id ? " highlighted" : ""}`,
                          style: { "--dcl-agent-accent": accent },
                          title: message.actionMode ? `${actionModeLabel(message.actionMode)} · 策略版本 ${message.policyRevision ?? 1}` : undefined
                        },
                          human ? null : h("div", { className: "dclMsgAvatar", title: system ? alias : `${alias} · ${statusLabel(participant?.runtime?.state)}` }, (alias || "A")[0].toUpperCase()),
                          h("div", { className: "dclMsgBody" },
                            h("div", { className: "dclMsgMeta" },
                              h("span", { className: "dclMsgAuthor" }, alias),
                              human || system ? null : h("span", { className: `dclStatusDot${["running", "waking", "idle"].includes(participant?.runtime?.state) ? " live" : ""}`, title: statusLabel(participant?.runtime?.state) }),
                              causeAlias ? h("button", { className: "dclReplyMeta dclReplyLink", onClick: () => jumpToMessage(cause.id), title: `查看 ${causeAlias} 的原消息${message.round ? ` · 第 ${message.round} 步` : ""}` }, lineIcon("reply"), `回应 ${causeAlias}`) : null,
                              corrected ? h("span", { className: "dclReplyMeta", title: `原消息时间 ${new Date(corrected.sentAt).toLocaleString()}` }, "纠正原消息") : null,
                              correction ? h("span", { className: "dclReplyMeta" }, "已有纠正") : null,
                              h("time", { className: "dclMsgTime", dateTime: new Date(message.sentAt).toISOString(), title: new Date(message.sentAt).toLocaleString() }, new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
                            ),
                            message.author==="system:work"?h("details",{className:"dclMsgText"},h("summary",null,message.text.split("\n")[0].slice(0,180)),h(MessageContent,{text:message.text,onFile:reference=>void previewArtifact(reference,message)})):h("div", { className: "dclMsgText" }, h(MessageContent,{text:message.text,onFile:reference=>void previewArtifact(reference,message)})),
                            message.savePending?h("p",{className:"dclLedgerWarning"},"保存尚未确认，未启动此任务；请使用原草稿重试。"):null,
                            message.author === "system:charter" ? h("button", { className: "dclAgentBtn", onClick: () => setInspectorMode("profile") }, "查看章程与修订 →") : null,
                            message.author === "system:work" ? h("button", { className: "dclAgentBtn", onClick: () => openLedgerRecord(message.ledgerEntryId ?? message.entryId) }, "查看协作条目 →") : null,
                            message.managementBatchId?h("button",{className:"dclAgentBtn",onClick:()=>{const batch=selectedRoom.managementBatches?.find(item=>item.id===message.managementBatchId);if(batch)setManagementDialog({batch});else setError("整理清单尚未同步，请稍后重试。");}},"查看整理清单与结果 →"):null,
                            references.length ? h("div", { className: "dclArtifactRefs", "aria-label": "消息中的工作区文件" }, references.map((reference) =>
                              h("button", { key: reference, className: "dclArtifactRef", onClick: () => void previewArtifact(reference, message), title: `打开 ${reference}` }, lineIcon("file"), reference.split(/[\\/]/u).pop() || reference)
                            )) : null,
                            message.mentions?.length ? h("div", { className: "dclMsgMentions", title: "这些 @ 会继续路由对话" }, message.mentions.map((mention) =>
                              h("span", { key: mention, className: "dclMsgMention" }, mentionLabel(mention))
                            )) : null,
                            deliveryText ? h("div", { className: "dclDelivery" },
                              h("span", {
                                className: "dclDeliveryItem " + (message.deliveries.some((item) => item.status === "failed") ? "failed" : ""),
                                title: message.deliveries.map(deliveryLabel).join(" · ")
                              }, deliveryText)
                            ) : null,
                            h("div", { className: "dclMsgActions", "aria-label": "消息操作" },
                              h("button",{className:"dclMsgAction",onClick:()=>void copyMessage(message.text)},lineIcon("copy"),"复制"),
                              h("button",{className:"dclMsgAction",disabled:conversationBusy||message.text.length>20000,onClick:()=>setBranchDraft({message,title:"",background:""}),title:"仅引用这条消息，另开独立对话"},"分支讨论"),
                              human ? h("button", { className: "dclMsgAction", onClick: () => { setCorrectionTarget(message); setCorrectionDraft(""); } }, lineIcon("edit"), correction ? "再次纠正" : "纠正") : null,
                              h("button", { className: "dclMsgAction", onClick: () => openLedgerEditor(undefined, message) }, lineIcon("ledger"), "记入台账"),
                              failedDeliveries.length ? h("button", { className: "dclMsgAction failed", disabled: roomCollaborationActive || Boolean(retryingMessageId), title: roomCollaborationActive ? "当前协作结束或停止后可重试" : "只重试失败的参与者", onClick: () => void retryFailed(message) }, retryingMessageId === message.id ? "重试中…" : `重试失败 ${failedDeliveries.length}`) : null
                            )
                          ))
                        );
                      })
                    )
                  ),
                  newMessageCount > 0 ? h("button", { className: "dclNewMessages", onClick: jumpToLatest }, `${newMessageCount} 条新消息 ↓`) : null
                ),
                h("div", { className: "dclSrOnly", role: "status", "aria-live": "polite" }, newMessageCount > 0 ? `${newMessageCount} 条新消息` : ""),
                h("footer", { className: "dclComposerWrap" },
                  h("div", { className: "dclComposer" },
                    roomCollaborationActive?h("div",{className:"dclAgentMeta",style:{padding:"6px 12px 0"}},"协作正在进行；现在发送新议题会中断旧轮次。草稿可先保留。"):null,
                    h("div", { className: "dclMentionBar", "aria-label": "选择收件人" },
                      !mentionAll && !inlineMentionAll && effectiveMentionIds.length === 0 ? h("span", { className: "dclRouteHint", title: selectedRoom.autoDeliver&&selectedRoom.members?.length ? "未指定收件人时依次询问参与者" : "这条消息只写入房间，不会唤醒 Agent" }, lineIcon(selectedRoom.autoDeliver&&selectedRoom.members?.length ? "users" : "book"), selectedRoom.autoDeliver&&selectedRoom.members?.length ? "自动" : "仅记录") : null,
                      selectedRoom.members?.length?h("button", { className: "dclMention" + (mentionAll ? " dclMentionOn" : ""), "aria-pressed": mentionAll, onClick: () => { const next = !mentionAll; setMentionAll(next); if (next) setMentionIds([]); rememberRoomUi(selectedRoom.id, { mentionAll: next, mentionIds: next ? [] : mentionIds }); } }, "@全部"):h("button",{className:"dclMention",onClick:()=>setInspectorMode("participants")},"添加成员"),
                      participants.map((participant) => {
                        const selected = !mentionAll && (mentionIds.includes(participant.sessionId) || inlineMentionIds.includes(participant.sessionId));
                        return h("button", { key: participant.sessionId, className: "dclMention" + (selected ? " dclMentionOn" : ""), "aria-pressed": selected, onClick: () => toggleMention(participant.sessionId) }, `@${participant.alias ?? participant.sessionId.slice(0, 8)}`);
                      })
                    ),
                    h("div", { className: "dclComposerRow" },
                      h("textarea", {
                        ref: textareaRef, className: "dclTextarea", value: draft, rows: 2, "aria-label": "群聊消息", onChange: (e) => { setDraft(e.target.value); rememberRoomUi(selectedRoom.id, { draft: e.target.value }); },
                        onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
                        placeholder: selectedRoom.members?.length?"提出议题，或 @成员 继续讨论…":"先记录想法，或添加成员开始协作…", maxLength:200000,
                        onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent?.isComposing) { e.preventDefault(); void send(); } }
                      })
                    ),
                    h("div", { className: "dclComposerFoot" },
                      h("div", { className: "dclAudience", title: selectedRoom.members?.length?audience:"添加成员后才会开始协作" }, !selectedRoom.members?.length?"尚未添加成员 · 消息仅记录":mentionAll || inlineMentionAll ? `发送给全部 ${participants.length} 位成员` : effectiveMentionIds.length ? `发送给 ${effectiveMentionIds.map((id) => participantById.get(id)?.alias ?? "成员").join("、")}` : selectedRoom.autoDeliver ? `${selectedRoom.members.length} 位成员依次参与 · 可随时点名` : "仅记录 · @成员才会唤醒"),
                      h("span", { className: "dclKeyHint" }, "Shift + Enter 换行"),
                      h("button", { className: "dclSend", onClick: () => void send(), disabled: sending || !draft.trim(), "aria-label": sending ? "发送中" : "发送" }, h("span", { className: "dclSendLabel" }, sending ? "发送中…" : "发送"), lineIcon("send"))
                    )
                  )
                )
              )
          ),
          pickerOpen ? h("div", {
                  className: "dclPickerBackdrop",
                  onMouseDown: (event) => { if (event.target === event.currentTarget) setPickerOpen(false); },
                  onKeyDown: (event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setPickerOpen(false);
                    }
                  }
                },
                  h("aside", { className: "dclPicker", role: "dialog", "aria-modal": true, "aria-label": "加入已有 DSH 会话" },
                    h("div", { className: "dclPickerHead" },
                      h("div", null,
                        h("div", { className: "dclPickerTitle" }, "加入已有 DSH 会话"),
                        h("div", { className: "dclPickerHint" }, "已有会话会携带其原历史；需要全新上下文时，请新建 DSH 会话。可按标题、工作目录或会话 ID 搜索。")
                      ),
                      h("button", { className: "dclClose", onClick: () => setPickerOpen(false), "aria-label": "关闭会话选择器" }, "×")
                    ),
                    h("input", { className: "dclInput", "data-dcl-initial-focus":true, value: sessionQuery, onChange: (e) => setSessionQuery(e.target.value), placeholder: `搜索 ${availableSessions.length} 个可用会话…` }),
                    h("div", { className: "dclPickerHint", style: { marginTop: 7 } }, filteredSessions.length > 30 ? `找到 ${filteredSessions.length} 个，先显示 30 个；继续输入可缩小范围。` : `找到 ${filteredSessions.length} 个会话`),
                    h("div", { className: "dclPickerResults" },
                      visibleSessions.length === 0 ? h("div", { className: "dclEmpty" }, normalizedQuery ? "没有匹配的会话" : "没有可加入的会话") : visibleSessions.map((id) =>
                        h("button", { key: id, className: "dclSessionRow", onClick: () => void addExisting(id), disabled: Boolean(attachingSessionId) },
                          h("div", { className: "dclAgentAvatar", style: { "--dcl-agent-accent": agentAccent(id) } }, (sessionLabel(id) || "S")[0].toUpperCase()),
                          h("div", { className: "dclSessionInfo" },
                            h("div", { className: "dclSessionTitle" }, sessionLabel(id)),
                            h("div", { className: "dclSessionMeta" }, sessionMeta(id))
                          ),
                          h("span", { className: "dclAgentBtn" }, attachingSessionId === id ? "加入中…" : "加入")
                        )
                      )
                    )
                  )
                ) : null,
          selectedRoom && inspectorMode && overlayInspector ? h("button", { className: "dclScrim dclInspectorScrim", onClick: () => setInspectorMode(null), "aria-label": "收起详情面板", tabIndex: -1 }) : null,
          selectedRoom && inspectorMode ? h("aside", { id: "dcl-inspector", role:overlayInspector?"dialog":undefined,"aria-modal":overlayInspector?true:undefined,tabIndex:-1, className: `dclInspector${inspectorMode === "artifact" && previewExpanded ? " dclInspectorExpanded" : ""}`, "aria-label": inspectorMode === "participants" ? "参与者检查器" : (inspectorMode === "profile" ? "房间章程" : (inspectorMode === "settings" ? "房间设置" : (inspectorMode === "ledger" ? "协作台账" : (inspectorMode === "search" ? "搜索群聊" : "文件检查器")))) },
            h("div", { className: "dclInspectorHead" },
              h("div", null,
                h("div", { className: "dclInspectorTitle" }, inspectorMode === "participants" ? `参与者 · ${participants.length}` : (inspectorMode === "profile" ? "房间章程" : (inspectorMode === "settings" ? "房间设置" : (inspectorMode === "ledger" ? `协作台账 · ${ledger.length}` : (inspectorMode === "search" ? "搜索群聊" : "工作区文件"))))),
                h("div", { className: "dclAgentMeta" }, inspectorMode === "participants" ? "管理成员、分工与模型" : (inspectorMode === "profile" ? "目标与共同遵守的协作约定" : (inspectorMode === "settings" ? "编辑这个房间的基本信息" : (inspectorMode === "ledger" ? "把讨论变成可追踪的进展" : (inspectorMode === "search" ? "查找整个房间的对话" : "只读预览 · 文件详情按需展开")))))
              ),
              h("button", { className: "dclClose", onClick: () => setInspectorMode(null), "aria-label": "关闭检查器" }, "×")
            ),
            h("div", { className: "dclInspectorBody", key: inspectorMode },
              inspectorMode === "participants" ? h(React.Fragment, null,
                h("div", { className: "dclAgentTools", style: { flexDirection: "column", alignItems: "stretch" } },h("div",{className:"dclInlineActions"},h("button",{className:"dclSecondary",onClick:()=>void openTeamSelection("existing")} ,"加入已有 Agent"),h("button",{className:"dclSecondary",onClick:()=>void openTeamSelection("new")},"建立新 Agent")),h("p",{className:"dclAgentMeta"},roomCollaborationActive?"可先準備名單；本輪結束後才能套用。不會自行中斷工作。":"只調整本對話；不改群組預選，也不會立即啟動工作。")),
                participants.length === 0 ? h("div", { className: "dclEmpty", style: { padding: "12px 0" } }, "暂无参与者。新建时只需名称，然后从 DSH 模型目录选择模型。") : participants.map((participant, index) =>
                  h("div", { key: participant.sessionId, className: "dclAgentRow", style: { alignItems: "flex-start" } },
                    h("div", { className: "dclAgentAvatar", style: { "--dcl-agent-accent": agentAccent(participant.memberId??participant.sessionId) } }, (participant.alias || "A")[0].toUpperCase()),
                    h("div", { className: "dclAgentInfo" },
                      h("div", { className: "dclAgentName" }, participant.alias ?? participant.sessionId.slice(0, 8)),
                      h("div", { className: "dclAgentMeta" }, `${statusLabel(participant.runtime?.state)} · @${participant.alias} · ${participant.ownership === "provisioned" ? "群聊创建" : "已有会话"}`),
                      h("div", { className: "dclAgentMeta" }, participant.nativeSetup?.state==="pending"?"尚未创建原生会话，将按本对话策略准备":`DSH 原生权限 · ${{"danger-full-access":"完全权限","workspace-write":"工作区内修改","read-only":"只读"}[participant.nativePermission] ?? participant.nativePermission ?? "未读取；打开原生会话可核对"}`),
                      participant.role ? h("div", { className: "dclAgentRole", title: participant.mandate || participant.role }, participant.role) : null,
                      participant.nativeSetup?.state==="pending" ? h("button",{className:"dclAgentBtn",disabled:managementBusy,onClick:async()=>{setManagementBusy(true);try{await prepareParticipant(participant);}catch(cause){setError(cause.message??String(cause));}finally{setManagementBusy(false);}}},`模型 · ${participant.nativeSetup.config.model.model} · 配置…`) : h(ModelBoundary, { key: `model:${participant.sessionId}` }, h(ParticipantModel, { sessionId: participant.sessionId,roomId:selectedRoom.id,sharedNative:participant.sharedNative,sharedWith:participant.sharedWith }))
                    ),
                    h("div", { className: "dclMemberActions" },
                      h("button", { className: "dclAgentBtn", disabled: roomCollaborationActive, onClick: () => setEditingMember({ ...participant, alias: participant.alias ?? "", role: participant.role ?? "", mandate: participant.mandate ?? "", roomRevision: selectedRoom.revision ?? 1 }), title: roomCollaborationActive ? "先停止当前协作轮" : undefined }, "编辑"),
                      h("button", { className: "dclAgentBtn", onClick: () => openSession(participant) }, "打开"),
                      h("div", { className: "dclMemberOrder" },
                        h("button", { className: "dclMiniButton", disabled: roomCollaborationActive || managementBusy || index === 0, onClick: () => void reorderMember(index, -1), title: roomCollaborationActive ? "先停止当前协作轮" : "提前自动协作顺序", "aria-label": `将 ${participant.alias} 上移` }, "↑"),
                        h("button", { className: "dclMiniButton", disabled: roomCollaborationActive || managementBusy || index === participants.length - 1, onClick: () => void reorderMember(index, 1), title: roomCollaborationActive ? "先停止当前协作轮" : "延后自动协作顺序", "aria-label": `将 ${participant.alias} 下移` }, "↓")
                      ),
                      h("button", { className: "dclAgentDel", disabled: roomCollaborationActive, onClick: () => setPendingRemoval(participant), title: roomCollaborationActive ? "先停止当前协作轮" : "只移出房间，不删除 DSH 会话" }, "移出")
                    )
                  )
                )
              ) : inspectorMode === "profile" ? h(React.Fragment, null,
                h(CharterMemory, { key: selectedRoom.id, room: selectedRoom, onRefresh: refreshRooms, onDraft: (text) => {
                  if (draft.trim()) { setNotice("输入框已有草稿。请先发送或清空，再发起章程整理。"); return; }
                  setDraft(text); setMentionAll(true); setMentionIds([]); setInspectorMode(null);
                  rememberRoomUi(selectedRoom.id, { draft: text, mentionAll: true, mentionIds: [] });
                  setNotice("已填入章程协作草稿，发送后开始。尚未触发 Agent。");
                } }),
                h("section", { className: "dclCharterSection" },
                  h("div", { className: "dclCharterLabel" }, "目标"),
                  h("p", { className: "dclCharterText" }, selectedRoom.profile?.purpose || "尚未设置房间目标")
                ),
                h("section", { className: "dclCharterSection" },
                  h("div", { className: "dclCharterLabel" }, "协作章程"),
                  h("pre", { className: "dclCharterText" }, selectedRoom.profile?.charter || "尚未设置房间章程")
                ),
                selectedRoom.profile?.source ? h("section", { className: "dclCharterSection" },
                  h("div", { className: "dclCharterLabel" }, "依据"),
                  h("div", { className: "dclSourceCard" },
                    h("div", { className: "dclSourceName" }, selectedRoom.profile.source.name),
                    h("div", { className: "dclSourceMeta" }, "外部原始记录 · 只读引用"),
                    selectedRoom.profile.source.path ? h("div", { className: "dclSourceMeta" }, selectedRoom.profile.source.path) : null,
                    selectedRoom.profile.source.sha256 ? h("div", { className: "dclSourceMeta", title: selectedRoom.profile.source.sha256 }, `SHA-256 · ${selectedRoom.profile.source.sha256.slice(0, 16)}…`) : null
                  )
                ) : null,
                participants.length ? h("section", { className: "dclCharterSection" },
                  h("div", { className: "dclCharterLabel" }, "职责分工"),
                  participants.map((participant) => h("div", { key: participant.sessionId, className: "dclAgentRow", style: { alignItems: "flex-start" } },
                    h("div", { className: "dclAgentAvatar", style: { "--dcl-agent-accent": agentAccent(participant.sessionId) } }, (participant.alias || "A")[0].toUpperCase()),
                    h("div", { className: "dclAgentInfo" },
                      h("div", { className: "dclAgentName" }, participant.alias),
                      h("div", { className: "dclAgentRole" }, participant.role || "未设置职责"),
                      participant.mandate ? h("div", { className: "dclSourceMeta" }, participant.mandate) : null
                    )
                  ))
                ) : null
              ) : inspectorMode === "settings" ? h(React.Fragment, null,
                h("p",{className:"dclAgentMeta"},"以下修改仅影响当前对话。成员与模型也在当前对话内独立配置。"),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "对话主题"),
                  h("input", { className: "dclInput", value: roomNameDraft, maxLength: 120, onChange: (event) => setRoomNameDraft(event.target.value), placeholder: "例如：研究小组" })
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "协作目标"),
                  h("textarea", { className: "dclFormTextArea", value: roomPurposeDraft, maxLength: 2000, onChange: (event) => setRoomPurposeDraft(event.target.value), placeholder: "这个房间最终要形成什么可核查的结果？" })
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "协作章程"),
                  h("textarea", { className: "dclFormTextArea large", value: roomCharterDraft, maxLength: 20000, onChange: (event) => setRoomCharterDraft(event.target.value), placeholder: "写明默认工作方式、权限边界、争议处理和交付标准。" })
                ),
                h("div", { className: "dclSettingsActions" },
                  h("button", { className: "dclPrimary", disabled: roomCollaborationActive || managementBusy || !roomNameDraft.trim(), title: roomCollaborationActive ? "先停止当前协作轮" : undefined, onClick: () => void saveRoomDetails() }, managementBusy ? "保存中…" : "保存修改")
                ),
                h("section",{className:"dclCharterSection",style:{marginTop:24}},h("div",{className:"dclCharterLabel"},"群组默认配置"),
                  h("p",{className:"dclCharterText"},"将已保存的成员、职务、模型、章程、协作方式和权限设为以后新对话的默认值。不复制目标、消息、台账或材料授权，不改变已有对话。"),
                  h("p",{className:"dclAgentMeta"},selectedGroup?.defaults?.frozen?`已保存 · 默认权限：${actionModeLabel(selectedGroup.defaults.defaultActionMode??"read_only_audit")}`:"尚未固定默认配置；首次新建将复用当前团队，权限从只读审阅开始。"),
                  h("button",{className:"dclSecondary",disabled:managementBusy||roomCollaborationActive||!selectedGroup,onClick:()=>setDefaultsDraft({name:selectedGroup.name,roomRevision:selectedRoom.revision,groupRevision:selectedGroup.revision,confirmRisk:false})},"设为群组默认…")),
                h("section",{className:"dclCharterSection",style:{marginTop:24}},h("div",{className:"dclCharterLabel"},"导出与备份"),
                  h("p",{className:"dclExportDescription"},"Markdown 包含完整对话与当前台账；JSON 保留完整房间快照和审计历史。保存到本机群聊数据目录的 exports 文件夹，不依赖浏览器下载，不会额外读取私聊或引用文件。"),
                  h("div",{className:"dclRoundActions"},h("button",{className:"dclSecondary",disabled:exporting,onClick:()=>void exportRoom("markdown")},"导出 Markdown"),h("button",{className:"dclSecondary",disabled:exporting,onClick:()=>void exportRoom("json")},"导出 JSON 备份")),
                  savedExport ? h("div",{className:"dclExportSaved",role:"status"},
                    h("strong",null,`已保存 · ${(savedExport.size/1024).toFixed(1)} KB`),
                    h("label",{className:"dclField"},"导出文件路径",h("input",{className:"dclFormInput",readOnly:true,value:savedExport.path,onFocus:event=>event.target.select()})),
                    h("button",{className:"dclSecondary",onClick:async()=>{try{await navigator.clipboard.writeText(savedExport.path);setNotice("已复制导出文件路径。");}catch{setError("剪贴板不可用，请选中导出路径手动复制。");}}},"复制导出路径")) : null,
                  h("p",{className:"dclExportDescription"},"v0.15.0 · 独立草稿、可选阵容与可追踪整理；每段对话仍独立导出，文件授权不跨对话扩散。")),
                h("section", { className: "dclCharterSection", style: { marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))" } },
                  h("div", { className: "dclCharterLabel" }, "删除当前对话"),
                  h("p", { className: "dclCharterText", style: { color: "var(--dsw-alias-label-secondary,#666)" } }, "删除后进入“已删除”，群聊消息和真实 DSH 会话都保留，可从房间栏恢复。"),
                  h("button", { className: "dclDanger", style: { marginTop: 10 }, disabled: managementBusy, onClick: () => setPendingRoomDelete(selectedRoom) }, "移至已删除")
                )
              ) : inspectorMode === "ledger" ? h(React.Fragment, null,
                h("div",{className:"dclLedgerActions"},h("button",{className:"dclSecondary",onClick:()=>setManagementDialog({})},"批量整理 / 终止…")),
                (selectedRoom.managementBatches??[]).filter(batch=>!['completed','dismissed'].includes(batch.state)).map(batch=>h("button",{key:batch.id,className:"dclActionLink",onClick:()=>setManagementDialog({batch})},`待确认整理 · ${batch.items.length} 项 · ${batch.reason}`)),
                h("div", { className: "dclLedgerToolbar" },
                  h("div", { className: "dclAgentMeta" }, `当前对话 · ${openTasks.length} 项任务待推进 · ${evidenceCount} 条证据 · ${needsUserCount} 项待我处理`),
                  h("button", { className: "dclPrimary", onClick: () => openLedgerEditor() }, "＋ 新建条目")
                ),
                h("div", { className: "dclLedgerFilter" },
                  h("select", { className: "dclSelect", value: ledgerFilter, "aria-label": "筛选协作台账", onChange: (event) => { setLedgerFilter(event.target.value); setFocusedLedgerId(null); } },
                    [["mine", "待我处理"], ["open", "未闭环"], ["all", "全部（含归档）"], ["task", "任务"], ["decision", "决定"], ["evidence", "证据"], ["dispute", "分歧"], ["in_review", "待验收"], ["blocked", "受阻"], ["archived", "已归档 / 已移除"]].map(([value, label]) => h("option", { value, key: value }, label))),
                  h("button", { className: "dclMiniButton", onClick: prepareWorkDraft }, "请成员整理待办")),
                h("input",{className:"dclInput","aria-label":"查找台账事项",value:ledgerQuery,maxLength:200,onChange:event=>setLedgerQuery(event.target.value),placeholder:"查找事项、负责人或阻断原因…",style:{width:"100%",marginBottom:12}}),
                !filteredLedger.length ? h("div", { className: "dclEmpty" },
                  h("div", { className: "dclEmptyIcon" }, lineIcon("ledger")),
                  h("div", { className: "dclEmptyTitle" }, ledger.length ? "当前筛选下没有事项" : "让讨论有下文"),
                  h("p", { className: "dclEmptyHint" }, ledger.length ? "已结束与归档事项可在“全部（含归档）”中找到。" : "成员会从讨论中登记任务、报告进展和保留分歧。交付不等于验收，建议也不会自动成为决定。"),
                  h("button", { className: "dclSecondary", onClick: ledger.length ? () => setLedgerFilter("all") : prepareWorkDraft }, ledger.length ? "查看全部事项" : "请成员整理待办")
                ) : h("div", { className: "dclLedgerList" }, filteredLedger.map((entry) => h(LedgerCard, {
                  key: entry.id, entry, members: participantById, busy: managementBusy, focused: focusedLedgerId === entry.id,
                  onEdit: openLedgerEditor, onStatus: requestLedgerStatus, onSnooze: snoozeLedger, onJump: jumpToMessage,
                  onTriage: requestLedgerTriage,
                  onBlocked: (entry) => { setError(""); setLedgerConfirmation({ kind: "blocked", entry, roomId: selectedRoom.id }); },
                  onRestore: (current, event) => { setError(""); setLedgerConfirmation({ kind: "restore", entry: current, event, roomId: selectedRoom.id }); }
                })))
              ) : inspectorMode === "search" ? h(React.Fragment, null,
                h("div", { className: "dclAgentTools", style: { flexDirection: "column", alignItems: "stretch" } },
                  h("input", { "data-dcl-initial-focus":true, className: "dclInput", value: searchQuery, onChange: (event) => setSearchQuery(event.target.value), onKeyDown: (event) => { if (event.key === "Enter" && !event.nativeEvent?.isComposing) { event.preventDefault(); void runSearch(); } }, placeholder: "搜索消息正文或成员名称…", "aria-label": "搜索文本" }),
                  h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6 } },
                    h("select", { className: "dclSelect", value: searchAuthor, onChange: (event) => setSearchAuthor(event.target.value), "aria-label": "按发言者筛选" },
                      h("option", { value: "" }, "全部发言者"),
                      h("option", { value: "human:me" }, "我"),
                      participants.map((participant) => h("option", { key: participant.sessionId, value: participant.sessionId }, participant.alias))
                    ),
                    h("select", { className: "dclSelect", value: searchDeliveryStatus, onChange: (event) => setSearchDeliveryStatus(event.target.value), "aria-label": "按投递状态筛选" },
                      h("option", { value: "" }, "全部状态"),
                      h("option", { value: "failed" }, "含失败投递"),
                      h("option", { value: "replied" }, "含已回复投递"),
                      h("option", { value: "superseded" }, "含过期投递")
                    ),
                    h("button", { className: "dclPrimary", disabled: searchBusy, onClick: () => void runSearch() }, searchBusy ? "搜索中…" : "搜索")
                  )
                ),
                h("div", { className: "dclAgentMeta", style: { marginBottom: 6 } }, `${searchResults.length} 条结果`),
                searchResults.length === 0 ? h("div", { className: "dclEmpty" }, "没有符合当前条件的消息。") : searchResults.slice().reverse().map((message) => h("button", { key: message.id, className: "dclSearchResult", onClick: () => jumpToMessage(message.id) },
                  h("div", { className: "dclAgentName" }, `${message.authorKind === "human" ? "我" : (message.authorAlias ?? participantById.get(message.author)?.alias ?? "系统")} · ${new Date(message.sentAt).toLocaleString()}`),
                  h("div", { className: "dclSearchSnippet" }, message.text)
                ))
              ) : h(React.Fragment, null,
                recoveryReturn?.roomId===selectedRoom.id?h("button",{className:"dclSecondary",onClick:()=>{setInspectorMode("ledger");setLedgerConfirmation({kind:"blocked",entry:ledger.find(item=>item.id===recoveryReturn.entry.id)??recoveryReturn.entry,roomId:selectedRoom.id});setRecoveryReturn(null);}},"返回阻断处理"):null,
                preview?.loading ? h("div", { className: "dclEmpty" }, "正在读取文件…") : preview?.candidates ? h(ArtifactResolutionChoices,{preview,onChoose:previewArtifact}) : preview?.error ? h("div", { className: "dclError", role: "alert" }, preview.error) : preview ? h(React.Fragment, null,
                  h("details", { className: "dclPreviewMeta" },
                    h("summary", null, "文件详情"),
                    h("div", null, `文件：${preview.artifact?.logicalName ?? preview.logicalName ?? "未知"}`),
                    h("div", null, `版本：${preview.artifact?.version?.id ?? "未知"}`),
                    h("div", null, `来源路径：${preview.artifact?.replica?.relativePath ?? "未知"}`),
                    h("div", null, `会话：${preview.artifact?.replica?.sessionId ?? "未知"}`)
                  ),
                  preview.extraction?.format === "docx" ? h(DocxReader,{key:`${preview.artifact?.id}:${preview.artifact?.version?.contentHash}`,preview,expanded:previewExpanded,onExpand:()=>setPreviewExpanded(value=>!value)}) : h(TextFileReader,{key:preview.artifact?.id,preview,onFile:path=>previewArtifact(path,{authorKind:"session",author:preview.artifact?.replica?.sessionId})})
                ) : h("div", { className: "dclEmpty" }, "在消息中点击文件引用，即可只读打开 DOCX、Markdown、代码和其他文本文件。"),
                artifacts.length ? h("div", { style: { marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))" } },
                  h("div", { className: "dclAgentMeta", style: { marginBottom: 6 } }, `文件记录 · ${artifacts.length}（含不同成员来源）`),
                  h("input",{className:"dclInput","aria-label":"搜索全部房间文件",placeholder:"搜索全部文件…",value:artifactQuery,onChange:event=>setArtifactQuery(event.target.value)}),
                  artifactQuery.trim()&&!artifacts.some(artifact=>artifact.logicalName.toLocaleLowerCase().includes(artifactQuery.trim().toLocaleLowerCase()))?h("p",{className:"dclAgentMeta"},"没有匹配的文件；清空搜索可查看全部文件。"):null,
                  artifacts.filter(artifact=>artifact.logicalName.toLocaleLowerCase().includes(artifactQuery.trim().toLocaleLowerCase())).slice().reverse().map((artifact) => h("button", {
                    key: artifact.id,
                    className: "dclRowButton",
                    onClick: () => void previewArtifact(artifact.replicas?.[0]?.relativePath ?? artifact.logicalName, { authorKind: "session", author: artifact.replicas?.[0]?.sessionId })
                  },
                    h("div", null, artifact.logicalName),
                    h("div", { className: "dclAgentMeta" }, `${artifact.versions?.length ?? 0} 个版本 · ${artifact.replicas?.length ?? 0} 个副本`)
                  ))
                ) : null
              )
            )
          ) : null,
          teamSelection&&selectedRoom?h(TeamUI.ParticipantPicker,{key:teamSelection.roomId,members:teamSelection.members,groupMembers:teamSelection.groupMembers,target:{kind:"conversation-members",id:teamSelection.roomId},initialMode:teamSelection.initialMode,onClose:()=>setTeamSelection(null),onApply:applyTeamSelection,extraContent:h("details",{className:"dclStartEnvironment"},h("summary",null,"新加入成員的工作環境"),h(TeamUI.DirectoryField,{label:"本次新增成員的工作目錄",value:teamSelection.environment.cwd,onChange:cwd=>setTeamSelection(value=>({...value,environment:{...value.environment,cwd}}))}),h("p",{className:"dclAgentMeta"},"現有成員的工作目錄不會被更換；新增成員沿用此對話權限。"),["full_access","workspace_write"].includes(teamSelection.mode)?h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:teamSelection.confirmed,onChange:event=>setTeamSelection(value=>({...value,confirmed:event.target.checked}))}),"若接續已有 DSH 會話，確認將其原生權限同步為本對話模式；這也影響原生會話及其他共享引用。"):null)}):null,
          pendingRemoval ? h("div", {
            className: "dclModelBackdrop",
            onMouseDown: (event) => { if (event.target === event.currentTarget) setPendingRemoval(null); },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPendingRemoval(null);
              }
            }
          },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": `移出 ${pendingRemoval.alias}` },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, `移出「${pendingRemoval.alias}」？`),
                  h("div", { className: "dclAgentMeta" }, selectedRoom?.orchestration?.state === "running"
                    ? "移出会终止当前协作轮；原 DSH 会话不会被删除。"
                    : "只移出当前房间；原 DSH 会话不会被删除。")
                )
              ),
              h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px" } },
                h("button", { "data-dcl-initial-focus":true, className: "dclSecondary", onClick: () => setPendingRemoval(null) }, "取消"),
                h("button", { className: "dclDanger", onClick: () => { const id = pendingRemoval.sessionId; setPendingRemoval(null); void removeMember(id); } }, "确认移出")
              )
            )
          ) : null,
          managementDialog&&selectedRoom?h("div",{className:"dclModelBackdrop",onKeyDown:event=>{if(event.key==="Escape"&&!managementBusy){event.stopPropagation();setManagementDialog(null);}}},h(ManagementPanel,{key:managementDialog.batch?.id??"new",room:selectedRoom,ledger,initial:managementDialog,onClose:()=>setManagementDialog(null),onBusy:setManagementBusy,onChanged:async()=>{await Promise.all([refreshRooms(),refreshLedger()]);}})):null,
          retryDialog&&selectedRoom?h("div",{className:"dclModelBackdrop",onKeyDown:event=>{if(event.key==="Escape"&&!retryingMessageId){event.stopPropagation();setRetryDialog(null);}}},h("section",{className:"dclModelDialog",tabIndex:-1,role:"dialog","aria-modal":true,"aria-label":"按当前权限接续"},h("div",{className:"dclInspectorHead"},h("strong",null,"核对后，以当前权限接续")),h("div",{className:"dclModelList"},h("p",null,`原投递：${actionModeLabel(retryDialog.message.actionMode)}；目前：${actionModeLabel(selectedRoom.policy.defaultActionMode)}。仅接续原先失败成员的未完成工作。`),h("p",{className:"dclDecisionImpact"},"先打开原会话核对已有结果。重启或超时不代表工具未执行；已经成功的文件修改不得重复。"),error?h("p",{className:"dclError",role:"alert"},error):null,h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:retryDialog.checked,onChange:event=>setRetryDialog({...retryDialog,checked:event.target.checked})}),"已核对已有结果，确认只接续未完成部分"),h("div",{className:"dclSettingsActions"},h("button",{className:"dclSecondary",disabled:Boolean(retryingMessageId),onClick:()=>setRetryDialog(null)},"取消"),h("button",{className:"dclPrimary",disabled:!retryDialog.checked||Boolean(retryingMessageId),onClick:()=>void retryFailed(retryDialog.message,{mode:"current",operationId:retryDialog.operationId,expectedPolicyRevision:retryDialog.policyRevision,confirmResultChecked:true})},"按当前权限接续"))))):null,
          roomComposerOpen?h(CreateGroupDialog,{name:newName,onName:value=>{setNewName(value);setGroupCreateError("");},source:groupSource,copyTeam,onCopy:setCopyTeam,busy:creatingRoom,issue:groupNameIssue(newName,rooms),error:groupCreateError,onClose:()=>setRoomComposerOpen(false),onCreate:()=>void createRoom()}):null,
          branchDraft ? h("div",{className:"dclModelBackdrop",onKeyDown:event=>{if(event.key==="Escape"){event.stopPropagation();if(!conversationBusy)setBranchDraft(null);}}},
            h("section",{className:"dclModelDialog",role:"dialog","aria-modal":true,"aria-label":"分支讨论"},
              h("div",{className:"dclInspectorHead"},h("strong",null,"从这条消息分支讨论")),
              h("div",{className:"dclModelList"},
                h("p",{className:"dclCharterText"},"保留当前对话，只引用下面这一条消息。不会复制活动任务、材料授权、原生会话历史，也不会自动开始执行。"),
                h("blockquote",{className:"dclCharterText",style:{maxHeight:160,overflow:"auto"}},branchDraft.message.text),
                h("label",{className:"dclFormField"},"新对话主题（可选）",h("input",{"data-dcl-initial-focus":true,className:"dclInput",maxLength:120,value:branchDraft.title,onChange:event=>setBranchDraft({...branchDraft,title:event.target.value})})),
                h("label",{className:"dclFormField"},"补充背景（可选，不作为自动执行指令）",h("textarea",{className:"dclFormTextArea",maxLength:8000,value:branchDraft.background,onChange:event=>setBranchDraft({...branchDraft,background:event.target.value})})),
                error?h("p",{className:"dclError",role:"alert"},error):null,
                ["inherit_dsh","workspace_write","full_access"].includes(selectedGroup?.defaults?.defaultActionMode)?h("label",{className:"dclDecisionOption"},h("input",{type:"checkbox",checked:Boolean(branchDraft.confirmRisk),disabled:conversationBusy,onChange:event=>setBranchDraft({...branchDraft,confirmRisk:event.target.checked})}),"新對話使用群組預設權限："+actionModeLabel(selectedGroup.defaults.defaultActionMode)+"。我已核對；建立分支不會立即執行。"):null,
                h("div",{className:"dclSettingsActions"},h("button",{className:"dclSecondary",disabled:conversationBusy,onClick:()=>setBranchDraft(null)},"取消"),h("button",{className:"dclPrimary",disabled:conversationBusy||(["inherit_dsh","workspace_write","full_access"].includes(selectedGroup?.defaults?.defaultActionMode)&&!branchDraft.confirmRisk),onClick:()=>void newConversation(branchDraft)},conversationBusy?"创建中…":"创建分支对话"))
              ))) : null,
          defaultsDraft ? h("div",{className:"dclModelBackdrop",onKeyDown:event=>{if(event.key==="Escape"){event.stopPropagation();if(!managementBusy)setDefaultsDraft(null);}}},
            h("section",{className:"dclModelDialog",role:"dialog","aria-modal":true,"aria-label":"保存群组默认配置"},
              h("div",{className:"dclInspectorHead"},h("strong",null,"保存群组默认配置")),
              h("div",{className:"dclModelList"},
                h("p",{className:"dclCharterText"},`将当前对话已保存的 ${participants.length} 位成员、职务、模型、章程及协作方式用于未来新对话。這些成員成為未來預選；完整群組名冊中的其他成員保留。已有对话不变；未保存的编辑不包含在内。`),
                h("label",{className:"dclFormField"},"群组名称",h("input",{"data-dcl-initial-focus":true,className:"dclInput",maxLength:120,value:defaultsDraft.name,onChange:event=>setDefaultsDraft({...defaultsDraft,name:event.target.value})})),
                h("p",{className:"dclCharterText"},`新对话默认权限：${actionModeLabel(selectedRoom.policy.defaultActionMode)}。具体任务范围仍需由新对话中的用户消息确定。`),
                ["inherit_dsh","workspace_write","full_access"].includes(selectedRoom.policy.defaultActionMode)?h("label",{className:"dclCharterText"},h("input",{type:"checkbox",checked:defaultsDraft.confirmRisk,onChange:event=>setDefaultsDraft({...defaultsDraft,confirmRisk:event.target.checked})})," 我确认以后新对话沿用此执行权限；完全权限可执行命令、修改文件，无额外审批。"):null,
                error?h("p",{className:"dclError",role:"alert"},error):null,
                h("div",{className:"dclSettingsActions"},h("button",{className:"dclSecondary",disabled:managementBusy,onClick:()=>setDefaultsDraft(null)},"取消"),h("button",{className:"dclPrimary",disabled:managementBusy||!defaultsDraft.name.trim()||(["inherit_dsh","workspace_write","full_access"].includes(selectedRoom.policy.defaultActionMode)&&!defaultsDraft.confirmRisk),onClick:()=>void saveDefaults()},managementBusy?"保存中…":"确认保存默认配置"))
              ))) : null,
          editingMember ? h("div", {
            className: "dclModelBackdrop",
            onMouseDown: (event) => { if (event.target === event.currentTarget) setEditingMember(null); },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditingMember(null);
              }
            }
          },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": `编辑 ${editingMember.alias}` },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, `编辑「${editingMember.alias}」`),
                  h("div", { className: "dclAgentMeta" }, "仅修改当前对话。名称用于 @点名；可在设置中另存为群组默认。")
                ),
                h("button", { className: "dclClose", onClick: () => setEditingMember(null), "aria-label": "关闭成员编辑" }, "×")
              ),
              h("div", { className: "dclModelList" },
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "群聊名称"),
                  h("input", { "data-dcl-initial-focus":true, className: "dclInput", maxLength: 120, value: editingMember.alias, onChange: (event) => setEditingMember((member) => ({ ...member, alias: event.target.value })), placeholder: "例如：方法设计部" })
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "职务"),
                  h("input", { className: "dclInput", maxLength: 1000, value: editingMember.role, onChange: (event) => setEditingMember((member) => ({ ...member, role: event.target.value })), placeholder: "例如：识别策略与统计口径审查" })
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "职责边界与交付要求"),
                  h("textarea", { className: "dclFormTextArea large", maxLength: 8000, value: editingMember.mandate, onChange: (event) => setEditingMember((member) => ({ ...member, mandate: event.target.value })), placeholder: "说明它负责什么、不得做什么、最后应交付什么。" })
                ),
                h("div", { className: "dclSettingsActions" },
                  h("button", { className: "dclSecondary", onClick: () => setEditingMember(null) }, "取消"),
                  h("button", { className: "dclPrimary", disabled: managementBusy || !editingMember.alias.trim(), onClick: () => void saveMember() }, managementBusy ? "保存中…" : "保存")
                )
              )
            )
          ) : null,
          editingLedger ? h("div", {
            className: "dclModelBackdrop",
            onMouseDown: (event) => { if (event.target === event.currentTarget) setEditingLedger(null); },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditingLedger(null);
              }
            }
          },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": editingLedger.id ? "编辑台账条目" : "新建台账条目" },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, editingLedger.id ? "编辑台账条目" : "新建台账条目"),
                  h("div", { className: "dclAgentMeta" }, "状态变化会追加审计历史；停滞监控只提醒指定协调人。")
                ),
                h("button", { className: "dclClose", onClick: () => setEditingLedger(null), "aria-label": "关闭台账编辑" }, "×")
              ),
              h("div", { className: "dclModelList" },
                h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                  h("label", { className: "dclFormField" },
                    h("span", { className: "dclFormLabel" }, "类型"),
                    h("select", { className: "dclSelect", value: editingLedger.kind, onChange: (event) => { const kind = event.target.value; setEditingLedger((entry) => ({ ...entry, kind, status: kind === "decision" ? "proposed" : "open", monitorEnabled: kind === "task" && entry.monitorEnabled })); } },
                      ["task", "decision", "evidence", "dispute"].map((kind) => h("option", { key: kind, value: kind }, ledgerKindLabel(kind)))
                    )
                  ),
                  h("label", { className: "dclFormField" },
                    h("span", { className: "dclFormLabel" }, "状态"),
                    h("select", { className: "dclSelect", value: editingLedger.status, onChange: (event) => setEditingLedger((entry) => ({ ...entry, status: event.target.value })) },
                      ledgerStatusOptions(editingLedger.kind).map((status) => h("option", { key: status, value: status }, ledgerStatusLabel(status)))
                    )
                  )
                ),
                ["done", "decided", "resolved"].includes(editingLedger.status) ? h("p", { className: "dclLedgerWarning" }, editingLedger.kind === "decision" && editingLedger.id && editingLedger.status === "decided"
                  ? "修改已采纳决定的标题或内容会退回待决定，旧采纳不会自动适用于新内容；保存后需要重新确认。"
                  : "保存这一结束状态表示由你确认结果；请先核对交付、讨论依据与验收要求。已有结束状态不会被伪造为新的历史验收。") : null,
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "标题"),
                  h("input", { "data-dcl-initial-focus":true, className: "dclInput", maxLength: 240, value: editingLedger.title, onChange: (event) => setEditingLedger((entry) => ({ ...entry, title: event.target.value })), placeholder: "一句话说明事项或决定" })
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "详情"),
                  h("textarea", { className: "dclFormTextArea", maxLength: 8000, value: editingLedger.details, onChange: (event) => setEditingLedger((entry) => ({ ...entry, details: event.target.value })), placeholder: "材料、版本、阻断或决定依据" })
                ),
                editingLedger.kind === "decision" ? h("section", { className: "dclLedgerRecord" },
                  h("label", { className: "dclFormField" }, h("span", { className: "dclFormLabel" }, "要用户决定的问题"), h("input", { className: "dclInput", maxLength: 600, value: editingLedger.question, onChange: (event) => setEditingLedger((entry) => ({ ...entry, question: event.target.value })), placeholder: "不填则使用标题；避免笼统请求全部权限。" })),
                  editingLedger.decisionOptions.map((option,index) => h("div", { key: option.id, className: "dclLedgerRecord" },
                    h("label", { className: "dclFormField" }, h("span", { className: "dclFormLabel" }, `方案 ${index+1}`), h("input", { className: "dclInput", maxLength: 160, value: option.label, onChange: (event) => setEditingLedger((entry) => ({ ...entry, decisionOptions: entry.decisionOptions.map((item,i) => i === index ? { ...item, label: event.target.value } : item) })) })),
                    h("label", { className: "dclFormField" }, h("span", { className: "dclFormLabel" }, `方案 ${index+1} 的影响`), h("textarea", { className: "dclFormTextArea", maxLength: 1200, value: option.description, onChange: (event) => setEditingLedger((entry) => ({ ...entry, decisionOptions: entry.decisionOptions.map((item,i) => i === index ? { ...item, description: event.target.value } : item) })) })))),
                  h("div", { className: "dclLedgerActions" }, h("button", { className: "dclMiniButton", disabled: editingLedger.decisionOptions.length >= 4, onClick: () => setEditingLedger((entry) => ({ ...entry, decisionOptions: entry.decisionOptions.length ? [...entry.decisionOptions, { id: `option-${Date.now()}`, label: "", description: "" }] : [{ id: "option-1", label: "", description: "" }, { id: "option-2", label: "", description: "" }] })) }, "添加备选方案"), editingLedger.decisionOptions.length ? h("button", { className: "dclMiniButton", onClick: () => setEditingLedger((entry) => ({ ...entry, decisionOptions: [] })) }, "清除备选方案") : null),
                  h("p", { className: "dclDecisionImpact" }, "提供 2–4 个可区分的选项，说明各自影响。选择只记录决策，不替代实际权限设置。")
                ) : null,
                h(LedgerRelationsEditor,{entries:ledger.filter(entry=>entry.id!==editingLedger.id),selected:editingLedger.relatedEntryIds,onChange:ids=>setEditingLedger(entry=>({...entry,relatedEntryIds:ids}))}),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "验收标准"),
                  h("textarea", { className: "dclFormTextArea", maxLength: 4000, value: editingLedger.acceptanceCriteria, onChange: (event) => setEditingLedger((entry) => ({ ...entry, acceptanceCriteria: event.target.value })), placeholder: "怎样才算真正闭环？" })
                ),
                h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
                  h("label", { className: "dclFormField" },
                    h("span", { className: "dclFormLabel" }, "负责人"),
                    h("select", { className: "dclSelect", "aria-label": "台账负责人", value: editingLedger.ownerSessionId, onChange: (event) => setEditingLedger((entry) => ({ ...entry, ownerSessionId: event.target.value })) },
                      h("option", { value: "" }, "暂不指定"),
                      editingLedger.ownerSessionId && !participantById.has(editingLedger.ownerSessionId) ? h("option", { value: editingLedger.ownerSessionId }, "原负责人已离开 · 请重新指定") : null,
                      participants.map((participant) => h("option", { key: participant.sessionId, value: participant.sessionId }, participant.alias))
                    )
                  ),
                  h("label", { className: "dclFormField" },
                    h("span", { className: "dclFormLabel" }, "期限（可选）"),
                    h("input", { className: "dclInput", type: "datetime-local", value: editingLedger.dueAtInput, onChange: (event) => setEditingLedger((entry) => ({ ...entry, dueAtInput: event.target.value })) })
                  )
                ),
                editingLedger.kind === "task" ? h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "独立验收人（可选）"),
                  h("select", { className: "dclSelect", "aria-label": "独立验收人", value: editingLedger.reviewerSessionId, onChange: (event) => setEditingLedger((entry) => ({ ...entry, reviewerSessionId: event.target.value })) },
                    h("option", { value: "" }, "由我验收"),
                    editingLedger.reviewerSessionId && !participantById.has(editingLedger.reviewerSessionId) ? h("option", { value: editingLedger.reviewerSessionId }, "原验收人已离开 · 请重新指定") : null,
                    participants.map((participant) => h("option", { key: participant.sessionId, value: participant.sessionId, disabled: participant.sessionId === editingLedger.ownerSessionId }, `${participant.alias}${participant.sessionId === editingLedger.ownerSessionId ? "（负责人不可自验收）" : ""}`))),
                  h("span", { className: "dclFormHint" }, "成员交付后进入待验收；指定另一位成员独立核对，或留给你确认。"),
                  editingLedger.reviewerSessionId && editingLedger.reviewerSessionId === editingLedger.ownerSessionId ? h("span", { className: "dclLedgerWarning", role: "alert" }, "负责人不能验收自己的交付，请换一位验收人。") : null) : null,
                editingLedger.sourceMessageId ? h("div", { className: "dclSourceCard", style: { marginBottom: 12 } },
                  h("div", { className: "dclSourceName" }, "已关联群聊消息"),
                  h("div", { className: "dclSourceMeta" }, messageById.get(editingLedger.sourceMessageId)?.text?.slice(0, 160) ?? editingLedger.sourceMessageId)
                ) : null,
                editingLedger.kind === "task" ? h("section", { className: "dclSourceCard", style: { marginBottom: 12 } },
                  h("label", { style: { display: "flex", alignItems: "center", gap: 7, cursor: "pointer" } },
                    h("input", { type: "checkbox", checked: editingLedger.monitorEnabled, disabled: participants.length === 0, onChange: (event) => setEditingLedger((entry) => ({ ...entry, monitorEnabled: event.target.checked })) }),
                    h("span", { className: "dclSourceName" }, "停滞后提醒协调人")
                  ),
                  editingLedger.monitorEnabled ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, marginTop: 9 } },
                    h("select", { className: "dclSelect", value: editingLedger.coordinatorSessionId, onChange: (event) => setEditingLedger((entry) => ({ ...entry, coordinatorSessionId: event.target.value })), "aria-label": "停滞提醒协调人" },
                      participants.map((participant) => h("option", { key: participant.sessionId, value: participant.sessionId }, participant.alias))
                    ),
                    h("input", { className: "dclInput", type: "number", min: 1, max: 10080, value: editingLedger.idleMinutes, onChange: (event) => setEditingLedger((entry) => ({ ...entry, idleMinutes: event.target.value })), "aria-label": "停滞分钟数" })
                  ) : null,
                  h("div", { className: "dclSourceMeta" }, "计时状态会持久保存；到时只 @指定协调人，不广播，不自动执行文件修改。")
                ) : null,
                h("div", { className: "dclSettingsActions" },
                  h("button", { className: "dclSecondary", onClick: () => setEditingLedger(null) }, "取消"),
                  h("button", { className: "dclPrimary", disabled: managementBusy || !editingLedger.title.trim() || (editingLedger.monitorEnabled && !editingLedger.coordinatorSessionId) || (editingLedger.kind === "task" && Boolean(editingLedger.reviewerSessionId) && editingLedger.reviewerSessionId === editingLedger.ownerSessionId), onClick: () => void saveLedgerEntry() }, managementBusy ? "保存中…" : "保存")
                )
              )
            )
          ) : null,
          ledgerConfirmation ? h("div", { className: "dclModelBackdrop", onMouseDown: (event) => { if (event.target === event.currentTarget && !managementBusy && !settingsBusy) setLedgerConfirmation(null); } },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": ledgerConfirmation.kind === "permission" ? "房间权限设置" : ledgerConfirmation.kind === "restore" ? "确认恢复台账版本" : ledgerConfirmation.kind === "blocked" ? "处理阻断" : "确认处理协作事项" },
              h("div", { className: "dclInspectorHead" },
                h("div", { className: "dclInspectorTitle" }, ledgerConfirmation.kind === "permission" ? "房间权限设置" : ledgerConfirmation.kind === "restore" ? "恢复历史版本" : ledgerConfirmation.kind === "blocked" ? "处理阻断" : ledgerConfirmation.status === "decided" ? "需要你决定" : "确认处理事项"),
                h("button", { className: "dclClose", disabled: managementBusy || settingsBusy, onClick: () => setLedgerConfirmation(null), "aria-label": ledgerConfirmation.kind === "permission" ? "关闭房间权限设置" : "关闭台账确认" }, "×")),
              h("div", { className: "dclModelList" },
                ledgerConfirmation.kind === "permission" ? h(React.Fragment, null,
                  h("p", { className: "dclDecisionImpact" }, "这里直接设置实际权限，不是采纳一条建议。切换不启动任务；之后可回受阻事项重试。"),
                  h("fieldset", { className: "dclDecisionChoices" }, h("legend", { className: "dclFormLabel" }, "选择权限模式"), [
                    ["discuss_only", "只读讨论", "允许安全读取 DOCX/文本及检索；群聊拦截命令和文件修改。"],
                    ["read_only_audit", "只读审计", "保持只读工具限制；用于核查与审阅，不自动修改文件。"],
                    ["inherit_dsh", "跟随 DSH", "移除群聊额外工具限制，不修改参与者原生设置；各会话可能具有不同权限。"],
                    ["workspace_write", "工作区内修改", "同步现有成员原生 workspace-write / ask：可在工作区修改，超出范围由 DSH 审批。"],
                    ["full_access", "完全权限", "同步现有成员原生 danger-full-access / never：允许命令、文件修改及外部操作，减少审批步骤。"]
                  ].map(([mode,label,description]) => h("label", { key: mode, className: `dclDecisionOption${ledgerConfirmation.mode === mode ? " selected" : ""}` },
                    h("input", { type: "radio", name: "room-permission", checked: ledgerConfirmation.mode === mode, disabled: settingsBusy, onChange: () => { setPermissionAcknowledged(false); setLedgerConfirmation((value) => ({ ...value, mode })); } }),
                    h("span", null, h("strong", null, label), h("span", { className: "dclDecisionImpact" }, description))))),
                  ["full_access", "workspace_write"].includes(ledgerConfirmation.mode) ? h("p", { className: "dclDecisionImpact" }, `影响的真实 DSH 会话：${participants.map((person) => person.alias).join("、") || "当前没有成员"}。原生设置在离开群聊后仍保留；以后切回群聊只读仅恢复群聊限制，不会静默重写会话设置。新增成员保持其原生权限，可在此重新应用同步。系统自身的权限限制仍有效。`) : null,
                  ledgerConfirmation.mode === "full_access" ? h("label", { className: "dclDecisionImpact" }, h("input", { type: "checkbox", checked: permissionAcknowledged, disabled: settingsBusy, onChange: (event) => setPermissionAcknowledged(event.target.checked) }), " 我了解影响，允许这些会话使用完全权限") : null,
                  roomCollaborationActive ? h("div", null, h("p", { className: "dclLedgerWarning" }, "当前协作正在运行。为避免执行中途换权限，请先停止本轮。"), h("button", { className: "dclDanger", disabled: managementBusy, onClick: () => void stopRoom() }, "停止本轮协作")) : null
                ) : ledgerConfirmation.kind === "triage" ? h(LedgerTriagePanel, {key:`${selectedRoom.id}:${ledgerConfirmation.entry.id}:${ledgerConfirmation.action}`,roomId:selectedRoom.id,entry:ledgerConfirmation.entry,action:ledgerConfirmation.action,onBusy:setManagementBusy,onSaved:ledgerTriageSaved,onCancel:()=>setLedgerConfirmation(null)}) : ledgerConfirmation.kind === "blocked" ? h(RecoveryPanel, {
                  key:`${selectedRoom.id}:${ledgerConfirmation.entry.id}`,roomId:selectedRoom.id,
                  entry: ledger.find(item=>item.id===ledgerConfirmation.entry.id)??ledgerConfirmation.entry,
                  related: workProtocol.related(ledger.find(item=>item.id===ledgerConfirmation.entry.id)??ledgerConfirmation.entry,ledger),
                  files: (selectedRoom.sharedFiles ?? []).filter((file) => /\.(?:docx|md|txt|markdown|csv|json|tex|bib)$/iu.test(file.path)).slice(-12),
                  owner: participantById.get(ledgerConfirmation.entry.ownerSessionId),
                  onRead: (path) => { setRecoveryReturn({roomId:selectedRoom.id,entry:ledgerConfirmation.entry});setLedgerConfirmation(null); void previewArtifact(path); },
                  onJump: (entry) => { if (entry.kind === "decision" && entry.status === "proposed") requestLedgerStatus(entry, "decided",ledgerConfirmation.entry); else { setLedgerConfirmation(null); openLedgerRecord(entry.id); } },
                  onRefresh:()=>Promise.all([refreshLedger(),refreshRooms()]),
                  onTriage:requestLedgerTriage,
                  onRetry: (mode) => prepareRecoveryDraft(ledgerConfirmation.entry, mode),
                  onPermissions: () => requestPolicy(selectedRoom.policy?.defaultActionMode ?? "discuss_only", ledgerConfirmation.entry),
                  onDecisions: () => { setLedgerConfirmation(null); openLedgerRecord(null, "decision"); },
                  onOpen: () => { const owner = participantById.get(ledgerConfirmation.entry.ownerSessionId); setLedgerConfirmation(null); if (owner) openSession(owner); },
                  onEdit: () => { const entry = ledgerConfirmation.entry; setLedgerConfirmation(null); openLedgerEditor(entry); }
                }) : ledgerConfirmation.kind === "restore" ? h(React.Fragment, null,
                  h("p", { className: "dclLedgerConfirm" }, `将 v${ledgerConfirmation.event.revision} 的内容恢复为新版本，不删除之后的历史。事项重新开放，进展、认领、交付及验收须重新进行；已离开的负责人或验收人不恢复，所有提醒监控保持关闭。`),
                  h("div", { className: "dclLedgerCompare", style: { marginTop: 12 } },
                    h("section", null, h("strong", { className: "dclFormLabel" }, `当前 v${ledgerConfirmation.entry.revision}`), h("pre", { className: "dclLedgerSnapshot" }, ledgerSnapshotText(ledgerConfirmation.entry, participantById))),
                    h("section", null, h("strong", { className: "dclFormLabel" }, `恢复后（取自 v${ledgerConfirmation.event.revision}）`), h("pre", { className: "dclLedgerSnapshot" }, ledgerSnapshotText(restoredLedgerSnapshot(ledgerConfirmation.event.after, participantById), participantById))))
                ) : h(React.Fragment, null,
                  h("h3", { className: "dclFormLabel" }, ledgerConfirmation.status === "decided" ? "要解决的问题" : ledgerConfirmation.entry.title),
                  ledgerConfirmation.status === "decided" ? h("p", { className: "dclLedgerDetails" }, ledgerConfirmation.entry.question || ledgerConfirmation.entry.title) : null,
                  h("p", { className: "dclDecisionImpact" }, ledgerConfirmation.status === "done" ? "确认会记录你的验收；请先核对交付与标准。补充说明可留空。" : ledgerConfirmation.status === "decided" ? "确认将记录你的选择，不会授予命令执行、改稿或整个目录的访问权限。DOCX/文本只读提取已经可用，无需在这里申请 bash。" : ledgerConfirmation.status === "in_progress" ? "交付会退回进行中，已有材料和审阅历史保留；可补充修改要求，也可直接确认。" : `将事项标为${ledgerStatusLabel(ledgerConfirmation.status)}，保留历史。`),
                  h("details", { className: "dclLedgerMore" }, h("summary", null, "背景、依据与验收标准"), h("pre", { className: "dclLedgerSnapshot" }, ledgerSnapshotText(ledgerConfirmation.entry, participantById))),
                  ledgerConfirmation.status === "decided" ? h(React.Fragment, null,
                    h(DecisionChoices, { entry: ledgerConfirmation.entry, choice: ledgerDecisionChoice, onChoice: setLedgerDecisionChoice }),
                    !ledgerConfirmation.entry.decisionOptions?.length ? h("p", { className: "dclDecisionImpact" }, "这条旧提议未提供分开的选项。若包含多种方案，请先让成员补齐，避免笼统采纳。") : null,
                    h("div", { className: "dclLedgerActions" },
                      h("button", { className: "dclMiniButton", disabled: managementBusy, onClick: () => prepareRecoveryDraft(ledgerConfirmation.entry, "clarify") }, "请成员补齐选项…"),
                      h("button", { className: "dclMiniButton", disabled: managementBusy, onClick: () => void setLedgerStatus(ledgerConfirmation.entry, "archived", "用户选择暂不采纳并归档") }, "暂不采纳，归档")),
                    h("label", { className: "dclDecisionImpact" }, h("input", { type: "checkbox", checked: notifyDecision, onChange: (event) => setNotifyDecision(event.target.checked) }), " 确认后通知提议者及关联任务负责人继续"),
                    roomCollaborationActive ? h("p", { className: "dclDecisionImpact" }, "通知会持久排队，在当前讨论结束后发送，不打断正在执行的回合。重启或手动停止后需核对并重新通知。") : null
                  ) : null,
                  h("label", { className: "dclFormField" }, h("span", { className: "dclFormLabel" }, "补充说明（可选）"),
                    h("textarea", { className: "dclFormTextArea", "aria-label": "台账处理说明", maxLength: 2000, value: ledgerReviewSummary, onChange: (event) => setLedgerReviewSummary(event.target.value), placeholder: "可直接确认；仅在需要补充条件或修改要求时填写。" }))),
                error ? h("p", { className: "dclLedgerWarning", role: "alert" }, error) : null,
                h("div", { className: "dclSettingsActions", style: { marginTop: 16 } },
                  ledgerConfirmation.kind!=="triage"?h("button", { className: "dclSecondary", "data-dcl-initial-focus":ledgerConfirmation.kind === "restore", disabled: managementBusy || settingsBusy, onClick: () => setLedgerConfirmation(null) }, ledgerConfirmation.kind === "blocked" ? "返回台账" : "取消"):null,
                  ledgerConfirmation.kind === "permission" ? h("button", { className: ledgerConfirmation.mode === "full_access" ? "dclDanger" : "dclPrimary", disabled: settingsBusy || roomCollaborationActive || ledgerConfirmation.mode === "full_access" && !permissionAcknowledged, onClick: () => void setPolicy(ledgerConfirmation.mode, true) }, settingsBusy ? "正在应用原生权限…" : ledgerConfirmation.mode === "full_access" ? "启用完全权限" : "应用权限设置") : !["blocked","triage"].includes(ledgerConfirmation.kind) ? h("button", { className: "dclPrimary", disabled: confirmationDisabled(managementBusy, ledgerConfirmation, ledgerDecisionChoice), onClick: () => ledgerConfirmation.kind === "restore" ? void restoreLedgerVersion() : void setLedgerStatus(ledgerConfirmation.entry, ledgerConfirmation.status, ledgerReviewSummary.trim(), ledgerConfirmation.entry.decisionOptions?.length ? ledgerDecisionChoice : undefined, ledgerConfirmation.status === "decided" && notifyDecision) }, managementBusy ? "保存中…" : ledgerConfirmation.kind === "restore" ? "恢复为新版本" : "确认并记录") : null)))) : null,
          correctionTarget ? h("div", {
            className: "dclModelBackdrop",
            onMouseDown: (event) => { if (event.target === event.currentTarget) { setCorrectionTarget(null); setCorrectionDraft(""); } },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setCorrectionTarget(null);
                setCorrectionDraft("");
              }
            }
          },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": "纠正消息" },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, "追加纠正"),
                  h("div", { className: "dclAgentMeta" }, "不会静默改写原文；已收到原消息的参与者会收到这条纠正。")
                ),
                h("button", { className: "dclClose", onClick: () => { setCorrectionTarget(null); setCorrectionDraft(""); }, "aria-label": "关闭纠正" }, "×")
              ),
              h("div", { className: "dclModelList" },
                h("div", { className: "dclSourceCard", style: { marginBottom: 12 } },
                  h("div", { className: "dclCharterLabel" }, "原消息"),
                  h("div", { className: "dclCharterText" }, correctionTarget.text)
                ),
                h("label", { className: "dclFormField" },
                  h("span", { className: "dclFormLabel" }, "纠正内容"),
                  h("textarea", { "data-dcl-initial-focus":true, className: "dclFormTextArea large", value: correctionDraft, onChange: (event) => setCorrectionDraft(event.target.value), placeholder: "例如：纠正上一条中的样本量，正确值为……" })
                ),
                h("div", { className: "dclSettingsActions" },
                  h("button", { className: "dclSecondary", onClick: () => { setCorrectionTarget(null); setCorrectionDraft(""); } }, "取消"),
                  h("button", { className: "dclPrimary", disabled: managementBusy || !correctionDraft.trim(), onClick: () => void correctMessage() }, managementBusy ? "发送中…" : "追加并通知")
                )
              )
            )
          ) : null,
          pendingRoomDelete ? h("div", {
            className: "dclModelBackdrop",
            onMouseDown: (event) => { if (event.target === event.currentTarget) setPendingRoomDelete(null); },
            onKeyDown: (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setPendingRoomDelete(null);
              }
            }
          },
            h("section", { className: "dclModelDialog", role: "dialog", "aria-modal": true, "aria-label": `删除 ${pendingRoomDelete.name}` },
              h("div", { className: "dclInspectorHead" },
                h("div", null,
                  h("div", { style: { fontWeight: 680 } }, `删除「${pendingRoomDelete.name}」？`),
                  h("div", { className: "dclAgentMeta" }, "房间会移入“已删除”；群聊记录和真实 DSH 会话不会被删除，之后仍可恢复。")
                )
              ),
              h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px" } },
                h("button", { "data-dcl-initial-focus":true, className: "dclSecondary", onClick: () => setPendingRoomDelete(null) }, "取消"),
                h("button", { className: "dclDanger", disabled: managementBusy, onClick: () => void deleteSelectedRoom() }, managementBusy ? "删除中…" : "移至已删除")
              )
            )
          ) : null
        );
      };
    }

    function makeWorkbench(ChatBody) {
      return function ChatWorkbench({ onClose, entryFocusRef }) {
        return h("section", { id: "dsh-chat-local-workbench", className: "dclWorkspace", "aria-label": "群聊工作区" },
          h(ChatBody, { onClose, entryFocusRef })
        );
      };
    }

    function makeFooterButton(ctx, ChatWorkbench) {
      return function FooterChatButton() {
        const [open, setOpen] = React.useState(false);
        const buttonRef = React.useRef(null);
        const entryFocusRef = React.useRef(null);
        const disposeWorkspace = React.useRef(null);
        const closeWorkspace = React.useCallback(() => {
          disposeWorkspace.current?.();
          disposeWorkspace.current = null;
          setOpen(false);
          queueMicrotask(() => buttonRef.current?.focus());
        }, []);
        const openWorkspace = React.useCallback(() => {
          if (disposeWorkspace.current) return;
          // DSH 0.1.5 removed the plain 'conversation' slot; global surfaces now
          // mount through the shell.overlay layer (same pattern as Deep Research).
          // order 30 keeps this workbench clear of the shipped occupants
          // (deepresearch 20, codex-connect 40) so two frame-wide overlays never tie.
          try {
            disposeWorkspace.current = ctx.slots.register({
              name: "shell.overlay",
              id: "dsh-chat-local-workbench",
              order: 30
            }, () => h(ChatWorkbench, { onClose: closeWorkspace, entryFocusRef }));
          } catch (error) {
            // A shell without this layer must not throw inside a click handler.
            disposeWorkspace.current = null;
            console.error("dsh-chat-local: 无法挂载群聊工作台（缺少 shell.overlay 槽位）", error);
            return;
          }
          setOpen(true);
        }, [closeWorkspace]);
        React.useEffect(() => () => {
          disposeWorkspace.current?.();
          disposeWorkspace.current = null;
        }, []);
        return h("button", {
          ref: buttonRef,
          className: "dclFooterBtn" + (open ? " dclFooterBtnOn" : ""),
          onClick: open ? closeWorkspace : openWorkspace,
          title: open ? "返回当前 DSH 会话" : "在主工作区打开本地多 Agent 群聊",
          "aria-expanded": open,
          "aria-controls": "dsh-chat-local-workbench"
        },
          lineIcon(open ? "arrow-left" : "chat", "dclFooterIcon"),
          h("span", { className: "dclFooterLabel" }, open ? "返回会话" : "群聊")
        );
      };
    }

    function apply(ctx) {
      ensureStyles();
      const ChatBody = makeChatBody(ctx);
      const ChatWorkbench = makeWorkbench(ChatBody);
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "dsh-chat-local",
        order: 40
      }, makeFooterButton(ctx, ChatWorkbench)));
    }

    module.exports = { name, inject, apply };
    return module.exports;
  }
});
