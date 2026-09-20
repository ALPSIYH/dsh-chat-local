import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DshChatLocalService } from '../lib/room-store.js';
import {createServer} from 'node:http';
import {isLocalRequestTarget} from '../lib/restricted-read.js';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'dcl-adversarial-read-'));
  const stateDirectory=join(directory,'store'), workspace=join(directory,'work');
  await mkdir(workspace); const path=join(stateDirectory,'rooms.json');
  const service=new DshChatLocalService({}, {path}); await service.ready;
  t.after(async()=>{await service.close();await rm(directory,{recursive:true,force:true});});
  await service.createRoom({name:'another private room',autoDeliver:false});
  // Exercise the same synchronous guard registered with the real ToolRuntime.
  service.policyLocks.set('reader',{active:true,actionMode:'discuss_only',roomId:'restricted'});
  const execute=(name,args,cwd=workspace)=>service.guardToolExecution({name,arguments:args,
    agent:{session:{id:'reader',header:{cwd}}}});
  return {directory,workspace,stateDirectory,path,execute};
}

test('restricted reads resolve relative paths and aliases before protecting private memory storage',async t=>{
  const h=await fixture(t);
  const alias=join(h.workspace,'innocent-notes.json'); await symlink(h.path,alias);
  const inputs=[['rooms.json',h.stateDirectory],['../store/rooms.json',h.workspace],
    [h.workspace+'/../store/rooms.json',h.workspace],[alias,h.workspace]];
  for(const [path,cwd] of inputs){
    assert.match(await readFile(path.startsWith('/')?path:join(cwd,path),'utf8'),/another private room/,'fixture reaches private state');
    assert.match(h.execute('read',{path},cwd)??'',/受限模式/,`unblocked private alias: ${path}`);
  }
  assert.equal(h.execute('read',{path:join(h.directory,'store-public','notes.txt')}),undefined,'a sibling directory is not private state');
});

test('restricted network reads normalize local IPv6 and DNS literal spellings',async t=>{
  const h=await fixture(t);
  for(const url of ['http://[::ffff:127.0.0.1]/','http://[::ffff:c0a8:101]/','http://localhost./',
    'http://service.local./','http://[fe90::1]/','http://[febf::1]/']){
    assert.match(h.execute('web_fetch',{url})??'',/本机或内网/,`unblocked local target: ${url}`);
  }
  for(const url of ['https://example.com/paper','https://[2001:4860:4860::8888]/']){
    assert.equal(h.execute('web_fetch',{url}),undefined);
  }
});

test('alternate WHATWG URL spellings that actually reach loopback are refused',async t=>{
  const h=await fixture(t),server=createServer((_req,res)=>res.end('fixture-private-state'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  for(const url of [`http:127.0.0.1:${port}/`,`http:/127.0.0.1:${port}/`,`http:\\127.0.0.1:${port}/`,
    `http://[::ffff:127.0.0.1]:${port}/`]){
    assert.equal(await(await fetch(url)).text(),'fixture-private-state','the URL really reaches the isolated local endpoint');
    assert.match(h.execute('web_fetch',{url})??'',/本机或内网/,url);
  }
  assert.equal(isLocalRequestTarget({url:'http://local\thost/'}),true);
});

test('public URL equivalents are not mistaken for files when the native cwd contains private state',async t=>{
  const h=await fixture(t);
  for(const url of ['https://example.com/paper','https:example.com/paper','https:/example.com/paper','https:\\example.com/paper']){
    assert.equal(new URL(url).hostname,'example.com');
    assert.equal(h.execute('web_fetch',{url},h.stateDirectory),undefined,url);
  }
});

test('seeded private IPv4 targets have the same classification in decimal, integer, hex and IPv6-mapped form',()=>{
  let seed=917;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let n=0;n<256;n++){
    const first=[10,127,172,192,169,8][next()%6],second=next()%256,third=next()%256,fourth=next()%256;
    const expected=first===10||first===127||first===172&&second>=16&&second<=31||first===192&&second===168||first===169&&second===254;
    const integer=first*2**24+second*2**16+third*256+fourth;
    const urls=[`${first}.${second}.${third}.${fourth}`,String(integer),`0x${integer.toString(16)}`,
      `[::ffff:${(first*256+second).toString(16)}:${(third*256+fourth).toString(16)}]`];
    for(const host of urls)assert.equal(isLocalRequestTarget({url:`http://${host}/`}),expected,host);
  }
});

async function nativeAliases(t) {
  const h=await fixture(t),other=join(h.directory,'other');
  await mkdir(join(other,'sub'),{recursive:true});
  await writeFile(join(other,'rooms.json'),'public decoy');
  await symlink(join(other,'sub'),join(h.workspace,'via'));
  await symlink(h.path,join(h.workspace,'rooms.json'));
  return h;
}

for(const input of ['via/../rooms.json','http://../rooms.json','file:///../rooms.json','~/../rooms.json']){
  test(`native literal path ${input} cannot bypass private-state isolation`,async t=>{
    const h=await nativeAliases(t),cwd=input.startsWith('via')?h.workspace:h.stateDirectory;
    // Installed dsh-fs-local resolves literal paths lexically before realpath.
    // Read the actual fixture target, so this oracle verifies content reached.
    assert.match(await readFile(resolve(cwd,input),'utf8'),/another private room/);
    assert.match(h.execute('read',{file_path:input},cwd)??'',/受限模式/);
  });
}

test('a lexical public target stays readable when resolving a symlink before dot-dot would reach private state',async t=>{
  const h=await fixture(t);
  await mkdir(join(h.stateDirectory,'sub'));
  await symlink(join(h.stateDirectory,'sub'),join(h.workspace,'via'));
  await writeFile(join(h.workspace,'rooms.json'),'public fixture');
  const file_path='via/../rooms.json';
  assert.equal(await readFile(resolve(h.workspace,file_path),'utf8'),'public fixture');
  assert.equal(h.execute('read',{file_path}),undefined);
});

test('URL-capable fetch still refuses private file URLs',async t=>{
  const h=await fixture(t);
  assert.match(h.execute('web_fetch',{url:pathToFileURL(h.path).href})??'',/受限模式/);
  assert.equal(h.execute('web_fetch',{url:pathToFileURL(join(h.workspace,'public.txt')).href},h.stateDirectory),undefined);
});

const hostModules=process.env.DSH_MODULES_DIR;
test('installed native filesystem resolver reaches the exact protected alias fixtures',{
  skip:!hostModules&&'set DSH_MODULES_DIR to run the installed native resolver',
},async t=>{
  const {LocalFileSystem}=await import(pathToFileURL(join(hostModules,'@deepseek-ai/dsh-fs-local/lib/index.js')));
  const h=await nativeAliases(t);
  for(const input of ['via/../rooms.json','http://../rooms.json','file:///../rooms.json','~/../rooms.json']){
    const cwd=input.startsWith('via')?h.workspace:h.stateDirectory;
    const target=await LocalFileSystem.prototype.resolve.call({config:{cwd}},input,{cwd});
    assert.match(await readFile(target.targetKey,'utf8'),/another private room/);
    assert.match(h.execute('read',{file_path:input},cwd)??'',/受限模式/);
  }
});
