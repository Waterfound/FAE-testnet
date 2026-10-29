'use strict';
// V35: real renderer command path to ORIGINAL protected Wallet #342 outbox.
// The CLI executes separately in an attested TTY; no vault secret, signed TX,
// decrypted intent, send, settle or outbox ACK may cross this GUI bridge.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const render=fs.readFileSync(path.join(root,'src','renderer.js'),'utf8');
const html=fs.readFileSync(path.join(root,'src','index.html'),'utf8');
function boot({available=true,terminal=async()=>({status:'CLI_EXIT_SUCCESS'})}={}){
  const elements=new Map();
  const get=id=>{
    if(!elements.has(id)){
      const events=new Map();
      elements.set(id,{
        events,textContent:'',value:'',hidden:false,disabled:true,
        classList:{toggle(){},contains(){return true}},
        addEventListener:(type,fn)=>events.set(type,fn),
        removeAttribute(){},setAttribute(){},replaceChildren(){},append(){}
      });
    }
    return elements.get(id);
  };
  const document={
    hidden:false,getElementById:get,querySelectorAll:()=>[],addEventListener(){}
  };
  let calls=0;
  const window={triumph:{
    onState:()=>()=>{},
    snapshot:async()=>({node:'stopped',miner:'stopped',telemetry:{}}),
    nativeWalletStatus:async()=>({
      state:available?'TRUSTED_SOURCE_AND_TTY_CANDIDATE':'UNAVAILABLE',
      custody:'EXTERNAL_NATIVE_TERMINAL_ONLY',
      signing:'NOT_ADMITTED',send:'DISABLED'
    }),
    nativeWalletTerminal:async cmd=>{calls++;return terminal(cmd)}
  }};
  vm.runInNewContext(render,{
    document,window,console,setTimeout,clearTimeout,
    matchMedia:()=>({matches:true,addEventListener(){}})
  },{filename:'renderer.js'});
  return {get,calls:()=>calls,ready:()=>new Promise(r=>setImmediate(r)),
    click:()=>get('native-wallet-outbox').events.get('click')()};
}
test('V35 original Wallet encrypted outbox is displayed as separate terminal action, never send',()=>{
  assert.match(html, /id="native-wallet-outbox"[^>]*disabled/);
  assert.match(html,/no transaction is sent, retried or acknowledged/i);
  assert.doesNotMatch(html,/id="native-wallet-send"/);
  assert.doesNotMatch(html,/id="native-wallet-settle"/);
});
test('V35 desktop refuses outbox operation unless original signer-owner source and TTY are ready',async()=>{
  const ui=boot({available:false,terminal:()=>{throw Error('must_not_execute')}});
  await ui.ready();
  assert.equal(ui.get('native-wallet-outbox').disabled,true);
  await ui.click();
  assert.equal(ui.calls(),0);
});
test('V35 trusted protected terminal outbox command does not expose decrypted intent, TXID or secrets',async()=>{
  const sensitive='NOT_FOR_RENDERER_SUPER_SECRET';
  const txid='a'.repeat(64);
  const ui=boot({terminal:async command=>{
    assert.equal(command,'outbox');
    return {command,status:'CLI_EXIT_SUCCESS',custody:'NATIVE_TERMINAL_SEPARATE_FROM_RENDERER',
      signer:'NOT_ATTESTED_BY_THIS_BRIDGE',outbox:'NOT_INSPECTED_BY_THIS_BRIDGE',
      password:sensitive,mnemonic:sensitive,txid,signed_transaction:sensitive};
  }});
  await ui.ready();
  assert.equal(ui.get('native-wallet-outbox').disabled,false);
  await ui.click();
  assert.equal(ui.calls(),1);
  const output=ui.get('native-wallet-operation').textContent;
  assert.match(output,/outbox command exited successfully in the separate terminal/);
  assert.match(output,/No payment was sent, retried or acknowledged/);
  for(const sensitiveField of [sensitive,txid,'signed_transaction','mnemonic'])
    assert.ok(!output.includes(sensitiveField),'No protected field may reach renderer');
});
test('V35 outbox inspection is single-flight, disabling all privileged Wallet controls while pending',async()=>{
  let release;
  const terminal=()=>new Promise(resolve=>{release=resolve});
  const ui=boot({terminal});
  await ui.ready();
  const p=ui.click();
  assert.equal(ui.calls(),1);
  for(const id of ['native-wallet-create','native-wallet-recover','native-wallet-address','native-wallet-outbox'])
    assert.equal(ui.get(id).disabled,true,id);
  await ui.click();
  assert.equal(ui.calls(),1,'must not run concurrent terminal operations');
  release({status:'CLI_EXIT_SUCCESS'});
  await p;
  assert.equal(ui.get('native-wallet-outbox').disabled,false);
});
test('V35 rejected outbox terminal never asserts inspected, settled, signed or sent',async()=>{
  const ui=boot({terminal:async()=>({command:'outbox',status:'CLI_EXIT_UNCONFIRMED'})});
  await ui.ready();await ui.click();
  const t=ui.get('native-wallet-operation').textContent;
  assert.match(t,/outbox result is unresolved or unavailable/);
  assert.match(t,/pending, unknown, or a terminal error/);
  assert.match(t,/No transaction was sent, retried or acknowledged/);
  assert.doesNotMatch(t,/outbox command exited successfully/);
});
