import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Independent adapter harness: authenticated local Wallet may be shown,
// but no synthetic balances, histories, keys or mutation may escape the Studio.
const html=readFileSync('design/wallet-studio-functional/index.html','utf8');
const source=readFileSync('design/wallet-studio-functional/empty-vault-adapter.js','utf8');
assert.doesNotMatch(html,/2,184\.72|\+18\.00 FAE|−4\.25 FAE|RECEIVED\s*·\s*184,197/);
assert.match(html,/class="active-composition"/);
assert.match(html,/class="balance-field"/);
assert.match(html,/class="wallet-rail"/);
assert.match(html,/class="flow-strip"/);
assert.doesNotMatch(html,/src="(?:\.\.\/)*approved-wallet-vr08-studio\/src\/vr11\.ts"/);
assert.doesNotMatch(source,/\.admitAccount\s*\(|\.setActiveWallet\s*\(|\.removeWallet\s*\(|\.sign\s*\(/);

function node(tag='div'){
  return {
    tag,children:[],textContent:'',hidden:true,dataset:{},className:'',
    classList:{add(){}},
    append(...children){this.children.push(...children)},
    replaceChildren(...children){this.children=[...children]},
    addEventListener(event,fn){(this.handlers??={})[event]=fn},
    remove(){this.removed=true}
  };
}
function fixture(options={}){
  const address=options.address??('faet1'+'q'.repeat(31));
  const state=options.state??{activeWalletId:'wallet-one'};
  const accounts=options.accounts??[{walletId:'wallet-one',network:'testnet',activeIndex:0,addresses:[{address}]}];
  const decrypted=options.decrypted??{addresses:[{address}]};
  const named={};
  for(const id of ['eventLine','flowCaption','actionDetail','actionEyebrow','actionContent','dismissAction','startNew','startRecovery'])named[id]=node(id);
  const selectors={};
  for(const sel of ['.balance-value strong','.balance-sub','.flow-strip','.flow-foot span:first-child',
    '.reference-data','.activity-list .list-head span','.wallet-rail',
    '.balance-upper .eyebrow','.micro-status'])selectors[sel]=node(sel);
  const views=['empty','create','active','recovery'].map(screen=>({
    ...node(screen),dataset:{screen},hidden:true,
    querySelector(sel){return screen==='empty'&&['.empty-primary','.empty-aside'].includes(sel)?node(sel):null}
  }));
  const root={dataset:{}};
  const document={
    documentElement:root,
    getElementById(id){return named[id]??null},
    querySelector(sel){if(sel==='[data-screen="empty"]')return views[0];return selectors[sel]??null},
    querySelectorAll(sel){
      if(sel==='[data-screen]')return views;
      if(sel==='[data-back="empty"]')return [node('back')];
      return [];
    },
    createElement:node
  };
  let calls={list:0,read:0,load:0,mutation:0};
  const vault={
    listWallets:async()=>{calls.list++;return accounts},
    readState:async()=>{calls.read++;return state},
    loadAccount:async()=>{calls.load++;if(options.rejectDecrypt)throw Error('tampered AES-GCM ciphertext');return decrypted},
    admitAccount:async()=>{calls.mutation++;throw Error('mutation forbidden')}
  };
  const promise=runInNewContext(source,{document,window:{FAEWalletVault:vault},Promise,Error});
  return {promise,root,named,selectors,views,calls,visible:()=>views.filter(v=>!v.hidden).map(v=>v.dataset.screen)};
}
const ok=fixture();
assert.deepEqual(ok.visible(),[],'No synthetic active Wallet may flash before the vault is authenticated');
await ok.promise;
assert.equal(ok.root.dataset.walletAdapter,'active-authenticated-read-only');
assert.deepEqual(ok.visible(),['active']);
assert.equal(ok.selectors['.balance-value strong'].textContent,'—');
assert.match(ok.selectors['.balance-sub'].textContent,/unavailable/);
assert.match(ok.selectors['.flow-strip'].textContent,/No verified movements/);
assert.equal(ok.selectors['.wallet-rail'].children.length,3);
assert.match(ok.selectors['.wallet-rail'].children[2].children[1].textContent,/faet1/);
assert.equal(ok.calls.load,1);
assert.equal(ok.calls.mutation,0);
assert.equal(ok.named.actionDetail.hidden,true,'No receive/send panel without deliberate action');
assert.ok(!ok.named.eventLine.textContent.includes('confirmed'),'Do not claim transaction confirmation');

const addressMismatch=fixture({decrypted:{addresses:[{address:'faet1'+'x'.repeat(31)}]}});
await addressMismatch.promise;
assert.equal(addressMismatch.root.dataset.walletAdapter,'fail-closed');
assert.deepEqual(addressMismatch.visible(),[],'Mismatched metadata must not display a Wallet');

const corrupt=fixture({rejectDecrypt:true});
await corrupt.promise;
assert.equal(corrupt.root.dataset.walletAdapter,'fail-closed');
assert.deepEqual(corrupt.visible(),[]);

const missingActive=fixture({state:{activeWalletId:null}});
await missingActive.promise;
assert.equal(missingActive.root.dataset.walletAdapter,'fail-closed');
assert.deepEqual(missingActive.visible(),[]);

const wrongNetwork=fixture({address:'not-a-testnet-address'});
await wrongNetwork.promise;
assert.equal(wrongNetwork.root.dataset.walletAdapter,'fail-closed');
assert.deepEqual(wrongNetwork.visible(),[]);

console.log('Studio authenticated active Wallet bridge PASS: vault identity, no fake data, fail-closed, zero mutation');
