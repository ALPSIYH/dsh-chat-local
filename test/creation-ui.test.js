import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('    function groupNameIssue('),source.indexOf('    function statusLabel('));
const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(value=>value!==null&&value!==undefined)});
function nodes(tree){const result=[];const visit=node=>{if(node&&typeof node==='object'){result.push(node);node.children?.forEach(visit);}};visit(tree);return result;}
function component(name,props,extra={}) {
  return vm.runInNewContext(`${helpers}\n${name}(props)`,{h,lineIcon:kind=>h('svg',{'data-icon':kind}),actionModeLabel:value=>value,props,...extra});
}
function dialog(overrides={}) {
  const calls=[];
  const props={name:'新团队',source:{id:'source',name:'原团队',members:[{sessionId:'a',alias:'审核'},{sessionId:'b',alias:'编辑'}]},copyTeam:true,busy:false,issue:'',error:'',onName:()=>{},onCopy:value=>calls.push(['copy',value]),onClose:()=>calls.push(['close']),onCreate:()=>calls.push(['create']),...overrides};
  const tree=component('CreateGroupDialog',props);
  return {tree,nodes:nodes(tree),calls};
}

test('group name checks mirror trimmed active-name conflicts without blocking deleted names',()=>{
  const context=vm.createContext({rooms:[{name:'现有团队'},{name:'已删除',deletedAt:1}]});
  vm.runInContext(helpers,context);
  assert.match(vm.runInContext('groupNameIssue(" 现有团队 ",rooms)',context),/已被/);
  assert.equal(vm.runInContext('groupNameIssue("已删除",rooms)',context),'');
  assert.equal(vm.runInContext('groupNameIssue("   ",rooms)',context),'');
  assert.match(vm.runInContext('groupNameIssue("x".repeat(121),rooms)',context),/120/);
});

test('conversation filtering is case insensitive, whitespace tolerant, and never mutates its source',()=>{
  const rooms=[{id:'a',name:'研究结构'},{id:'b',name:'Methods review'},{id:'c',name:'方法讨论'}];
  const run=query=>vm.runInNewContext(`${helpers}\nfilterConversations(rooms,query)`,{rooms,query});
  assert.deepEqual(run('  METHODS '),[rooms[1]]);
  assert.deepEqual(run('方法'),[rooms[2]]);
  assert.equal(run('  '),rooms);
  assert.equal(rooms.length,3);
});

test('group creation is an accessible form dialog with explicit reusable-team and blank options',()=>{
  const result=dialog();const form=result.nodes.find(node=>node.type==='form');
  assert.equal(form.props.role,'dialog');assert.equal(form.props['aria-modal'],true);
  assert.equal(result.nodes.find(node=>node.props.id===form.props['aria-labelledby']).children[0],'新建群组');
  const input=result.nodes.find(node=>node.type==='input'&&node.props['aria-label']==='群组名称');
  assert.equal(input.props.maxLength,120);assert.equal(input.props['data-dcl-initial-focus'],true);
  const choices=result.nodes.filter(node=>node.props.type==='radio');
  assert.equal(choices.length,2);assert.equal(choices[0].props.checked,true);assert.equal(choices[1].props.checked,false);
  choices[1].props.onChange();assert.deepEqual(result.calls,[['copy',false]]);
  assert.match(JSON.stringify(result.tree),/原团队 · 2 位成员/);
});

test('empty or invalid names cannot submit; changing radio choice cannot submit the form',()=>{
  for(const overrides of [{name:' '},{issue:'名称已被使用'}]){
    const result=dialog(overrides);
    assert.equal(result.nodes.find(node=>node.props.type==='submit').props.disabled,true);
    result.nodes.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(result.calls.length,0);
  }
  const valid=dialog();valid.nodes.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.deepEqual(valid.calls,[['create']]);
});

test('creation keeps failure text in the dialog and guards Escape during submission and IME composition',()=>{
  const busy=dialog({busy:true,error:'连接中断，输入已保留'});
  busy.tree.props.onKeyDown({key:'Escape',stopPropagation(){}});
  assert.equal(busy.calls.length,0);assert.equal(busy.nodes.find(node=>node.type==='fieldset').props.disabled,true);
  assert.ok(busy.nodes.some(node=>node.props.role==='alert'&&node.children[0].includes('连接中断')));
  const idle=dialog();idle.tree.props.onKeyDown({key:'Escape',stopPropagation(){}});
  assert.deepEqual(idle.calls,[['close']]);
  let prevented=false;
  idle.nodes.find(node=>node.props['aria-label']==='群组名称').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
});

test('first group hides the unavailable reuse option and explains the blank-group next step',()=>{
  const result=dialog({source:null,copyTeam:false});
  const choices=result.nodes.filter(node=>node.props.type==='radio');
  assert.equal(choices.length,1);assert.equal(choices[0].props.checked,true);
  assert.match(JSON.stringify(result.tree),/创建后添加成员/);
  assert.doesNotMatch(JSON.stringify(result.tree),/复用当前团队/);
});

test('conversation welcome exposes useful actions but never sends messages or changes permissions',()=>{
  const calls=[];
  const props={room:{creation:{},autoDeliver:false,policy:{defaultActionMode:'read_only_audit'}},members:[{sessionId:'a',alias:'审阅'}],onParticipants:()=>calls.push('participants'),onCompose:()=>calls.push('compose')};
  const tree=component('ConversationWelcome',props),all=nodes(tree);
  assert.match(JSON.stringify(tree),/当前仅记录消息/);
  all.find(node=>node.props.className==='dclWelcomeMember').props.onClick();
  all.find(node=>node.props.className?.includes('dclWelcomeStart')).props.onClick();
  assert.deepEqual(calls,['participants','compose']);
  const empty=component('ConversationWelcome',{...props,members:[]});
  assert.ok(nodes(empty).some(node=>node.type==='button'&&node.children[0]==='添加成员'));
});

function creationHarness() {
  const segment=source.slice(source.indexOf('        const createRoom = async () => {'),source.indexOf('        const newConversation ='));
  const calls=[];
  const context={newName:'  验证团队  ',rooms:[],groups:[],creatingRoom:false,groupCreationRef:{current:false},copyTeam:true,groupSource:{id:'explicit-source'},selectedRoom:{id:'different-current'},compactWorkspace:false,error:'',closed:false,
    groupNameIssue:()=>'',
    setCreatingRoom:value=>{context.creatingRoom=value;},setGroupCreateError:value=>{context.error=value;},
    setRooms:update=>{context.rooms=update(context.rooms);},setGroups:update=>{context.groups=update(context.groups);},
    setNewName:value=>{context.newName=value;},setRoomComposerOpen:value=>{context.closed=!value;},setCopyTeam(){},setGroupSource(){},setConversationQuery(){},setConversationSearchOpen(){},setGroupChoice(){},setSelectedId:value=>{context.selectedId=value;},setRoomSidebarOpen(){},setRoomListError:value=>{context.listError=value;},
    api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return context.respond();},respond:()=>({id:'created',groupId:'created',name:'验证团队'}),refreshRooms:async()=>{throw new Error('list offline');}
  };
  const run=vm.runInNewContext(`${segment}\ncreateRoom`,context);
  return {context,calls,run};
}

test('successful creation navigates once even when list refresh fails, using the explicit previewed source',async()=>{
  const result=creationHarness();await result.run();await Promise.resolve();
  assert.equal(result.context.error,'');assert.equal(result.context.closed,true);
  assert.equal(result.context.selectedId,'created');assert.equal(result.context.newName,'');
  assert.equal(result.calls[0].body.copyFromRoomId,'explicit-source');
  assert.equal(result.calls[0].body.name,'验证团队');
  assert.match(result.context.listError,/已创建/);
});

test('uncertain group creation preserves input and reports locally without false success',async()=>{
  const result=creationHarness();result.context.respond=()=>{throw new Error('network offline');};await result.run();
  assert.equal(result.context.newName,'  验证团队  ');assert.equal(result.context.closed,false);
  assert.equal(result.context.selectedId,undefined);assert.equal(result.context.rooms.length,0);
  assert.match(result.context.error,/输入已保留/);
  assert.equal(result.context.groupCreationRef.current,false);
});

test('double creation submission is coalesced before the next React render',async()=>{
  const result=creationHarness();let resolve;
  result.context.respond=()=>new Promise(done=>{resolve=done;});
  const first=result.run();result.context.creatingRoom=false;await result.run();
  assert.equal(result.calls.length,1);
  resolve({id:'created',groupId:'created',name:'验证团队'});await first;
  assert.equal(result.context.groupCreationRef.current,false);
});

test('blank-group submission cannot inherit a source or an execution policy',async()=>{
  const result=creationHarness();result.context.copyTeam=false;await result.run();
  assert.equal(result.calls[0].body.copyFromRoomId,undefined);
  assert.equal(result.calls[0].body.defaultActionMode,undefined);
});

test('new dialog participates in background isolation; creation no longer expands navigation',()=>{
  const focus=source.slice(source.indexOf('          if(!(pendingRemoval'),source.indexOf('        React.useEffect(()=>{\n          if(!inspectorMode'));
  assert.match(focus,/roomComposerOpen/);assert.match(focus,/el\.inert=true/);assert.match(focus,/previous\.focus/);
  assert.doesNotMatch(source,/dclNewRoomForm/);
  assert.match(source,/data-dcl-group-picker\],\.dclConversationSearch/);
  assert.match(source,/!roomSidebarOpen\?h\("button"/);
});

test('new conversation acknowledgement survives a failed list refresh and clears its retry receipt',async()=>{
  const segment=source.slice(source.indexOf('        const newConversation = async'),source.indexOf('        const saveDefaults ='));
  const storage=new Map(),context={selectedGroup:{id:'group'},conversationBusy:false,conversationCreationRef:{current:null},roomScopeRef:{current:{generation:2}},selectedIdRef:{current:'old'},compactWorkspace:false,rooms:[],crypto,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setConversationBusy(value){context.conversationBusy=value;},setError(value){context.error=value;},setRooms(update){context.rooms=update(context.rooms);},setBranchDraft(){},setConversationQuery(){},setConversationSearchOpen(){},setGroupChoice(){},setSelectedId(value){context.selectedIdRef.current=value;},setTimeout(){},
    api:async()=>({id:'fresh',groupId:'group',name:'新对话'}),refreshRooms:async()=>{throw new Error('offline');},setRoomListError(value){context.listError=value;}
  };
  await vm.runInNewContext(`${segment}\nnewConversation()`,context);await Promise.resolve();
  assert.equal(context.error,'');assert.equal(context.selectedIdRef.current,'fresh');
  assert.equal(storage.size,0);assert.equal(context.conversationCreationRef.current,null);
  assert.match(context.listError,/对话已创建/);
});

test('empty-team composer offers member setup instead of claiming zero members will collaborate',()=>{
  assert.match(source,/尚未添加成员 · 消息仅记录/);
  assert.match(source,/先记录想法，或添加成员开始协作/);
  assert.match(source,/selectedRoom\.members\?\.length\?h\("button", \{ className: "dclMention"/);
});
