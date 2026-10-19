import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// A pure public-read verification. Never uses production network or private keys.
const source=readFileSync('design/wallet-studio-functional/studio-chain-read.js','utf8');
const transactionAdapter=readFileSync('wallet-transactions.js','utf8');
const html=readFileSync('design/wallet-studio-functional/index.html','utf8');
assert.match(html,/src="\.\/studio-chain-read\.js"/);
assert.match(html,/src="\.\.\/\.\.\/wallet-transactions\.js"/);
assert.doesNotMatch(source,/\.admitAccount\(|crypto\.subtle|\.sign\(|mnemonic|private.key|seedPhrase/i);

function toAtoms(value){
  const text=String(value);
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(text))return '0';
  const [whole,fraction='']=text.split('.');
  return (BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0')||'0')).toString();
}
function fixture(options={}){
  const nodes=new Map();
  function node(){
    return {textContent:'',className:'',children:[],title:'',
      append(...n){this.children.push(...n)},
      replaceChildren(...n){this.children=[...n];this.textContent=''},
      remove(){this.removed=true},
      querySelectorAll(){return this.children.filter(c=>c.className==='activity-row')}
    };
  }
  const selectors=['.balance-value strong','.balance-sub','.reference-data',
    '.activity-list .list-head span','.flow-strip','.flow-foot span:first-child',
    '.balance-label','.activity-list'];
  for(const sel of selectors)nodes.set(sel,node());
  nodes.set('#flowCaption',node());
  const document={
    querySelector(sel){return nodes.get(sel)||null},
    getElementById(id){return nodes.get('#'+id)||null},
    createElement:node
  };
  const urls=[];
  const fetch=async(url,{signal}={})=>{
    urls.push(url);
    if(signal?.aborted)throw Error('aborted');
    if(options.fetchOverride)return options.fetchOverride(url,{signal});
    if(url.endsWith('/status'))return {ok:true,json:async()=>options.status??({ok:true,height:100,network:'fairyelf-public-testnet-v4'})};
    if(url.includes('/balance?')){
      if(options.networkFailure)throw Error('offline');
      return {ok:true,json:async()=>({
        ok:options.balanceOk??true,
        address:options.balanceAddress??new URL(url).searchParams.get('address'),
        balance_fae:options.balance??'12.5',
        balance_atoms:options.balanceAtoms??toAtoms(options.balance??'12.5')
      })};
    }
    if(url.includes('/transactions?')){
      if(options.historyFailure)throw Error('offline');
      return {ok:true,json:async()=>({ok:options.historyOk??true,transactions:options.transactions??[]})};
    }
    throw Error('unrecognized route');
  };
  const window={};
  runInNewContext(transactionAdapter,{window,globalThis:window,Date,BigInt,Object});
  if(options.historyNormalizerThrows){
    window.FAEWalletTransactions={normalizeHistoryPayload(){throw Error('Malformed history normalization')}};
  }
  runInNewContext(source,{window,document,fetch,AbortController,BigInt,Promise,setTimeout,clearTimeout});
  return {engine:window.FAEStudioChainRead,nodes,urls};
}
const address='faet1'+'q'.repeat(31);
const good=fixture();
await good.engine.refresh(address);
assert.equal(good.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(good.nodes.get('.balance-sub').textContent,/Confirmed/);
assert.match(good.nodes.get('.reference-data').textContent,/BOUNDED SOURCE/);
assert.match(good.nodes.get('.activity-list .list-head span').textContent,/NOT LIFETIME/);
assert.deepEqual(good.urls.map(u=>u.slice(u.lastIndexOf('/')+1).split('?')[0]),['status','balance','transactions']);
assert.ok(good.urls.every(u=>!u.includes('secret')&&!u.includes('private')));

const offline=fixture({networkFailure:true,historyFailure:true});
await offline.engine.refresh(address);
assert.equal(offline.nodes.get('.balance-value strong').textContent,'—');
assert.match(offline.nodes.get('.reference-data').textContent,/UNAVAILABLE/);

const zero=fixture({balance:'0'});
await zero.engine.refresh(address);
assert.equal(zero.nodes.get('.balance-value strong').textContent,'0');

// Source-bound negative cases: an address mismatch or inconsistent units
// must never appear as the selected Wallet's authenticated public balance.
for(const bad of [
  {balanceAddress:'faet1'+'x'.repeat(31)},
  {balanceOk:false},
  {balanceAtoms:'1250000001'},
  {balanceAtoms:'invalid'}
]){
  const hostile=fixture(bad);
  await hostile.engine.refresh(address);
  assert.equal(hostile.nodes.get('.balance-value strong').textContent,'—',
    'Unbound or inconsistent public balance must never be displayed');
  assert.match(hostile.nodes.get('.balance-sub').textContent,/could not be verified/);
}
const rejectedHistory=fixture({historyOk:false});
await rejectedHistory.engine.refresh(address);
assert.equal(rejectedHistory.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(rejectedHistory.nodes.get('.reference-data').textContent,/UNAVAILABLE/);

const invalid=fixture({balance:'NaN'});
await invalid.engine.refresh(address);
assert.equal(invalid.nodes.get('.balance-value strong').textContent,'—');

// A malformed JSON array must not be coerced into a valid scalar balance.
const arrayBalance=fixture({balance:['12.5']});
await arrayBalance.engine.refresh(address);
assert.equal(arrayBalance.nodes.get('.balance-value strong').textContent,'—');

// A broken history normalizer must not erase an independently verified balance.
const badHistory=fixture({historyNormalizerThrows:true});
assert.equal(await badHistory.engine.refresh(address),true);
assert.equal(badHistory.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(badHistory.nodes.get('.reference-data').textContent,/UNAVAILABLE/);

// Reject a public history exceeding the source's 30-transfer address cap.
 // A valid balance remains independently verified; unbounded history never renders.
const transfer=(n)=>({
  txid:n.toString(16).padStart(64,'0'),
  from_address:'faet1'+'r'.repeat(31),
  outputs:[{address,amount_atoms:'100000000'}],
  status:'confirmed',
  confirmed_height:1
});
const boundedHistory=fixture({transactions:Array.from({length:30},(_,i)=>transfer(i+1))});
assert.equal(await boundedHistory.engine.refresh(address),true);
assert.equal(boundedHistory.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(boundedHistory.nodes.get('.reference-data').textContent,/BOUNDED SOURCE/);
// A future confirmed height is impossible relative to the independently
// checked /status tip. Reject only history, never an independently bound balance.
const atTip=fixture({transactions:[{...transfer(44),confirmed_height:100}]});
await atTip.engine.refresh(address);
assert.match(atTip.nodes.get('.reference-data').textContent,/BOUNDED SOURCE/);
const beyondTip=fixture({transactions:[{...transfer(45),confirmed_height:101}]});
await beyondTip.engine.refresh(address);
assert.equal(beyondTip.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(beyondTip.nodes.get('.reference-data').textContent,/UNAVAILABLE/,
  'Future-height transfer must not be presented as verified history');
const overLimitHistory=fixture({transactions:Array.from({length:31},(_,i)=>transfer(i+1))});
assert.equal(await overLimitHistory.engine.refresh(address),true);
assert.equal(overLimitHistory.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(overLimitHistory.nodes.get('.reference-data').textContent,/UNAVAILABLE/,
  'Over-limit history must fail closed rather than be displayed as verified');

// Bound per-transaction work and BigInt input from the untrusted history API.
// A verified balance remains available, while adversarial history fails closed.
const outputFlood=fixture({transactions:[{
  ...transfer(46),
  outputs:Array.from({length:257},()=>({address,amount_atoms:'1'}))
}]});
await outputFlood.engine.refresh(address);
assert.equal(outputFlood.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(outputFlood.nodes.get('.reference-data').textContent,/UNAVAILABLE/,
  'A transaction output flood must not be normalized or rendered');

const oversizedAtomAmount=fixture({transactions:[{
  ...transfer(47),
  outputs:[{address,amount_atoms:'10000000000000000'}]
}]});
await oversizedAtomAmount.engine.refresh(address);
assert.equal(oversizedAtomAmount.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(oversizedAtomAmount.nodes.get('.reference-data').textContent,/UNAVAILABLE/,
  'Oversized atom precision must fail before BigInt rendering');

const maxOutputBoundary=fixture({transactions:[{
  ...transfer(48),
  outputs:Array.from({length:256},()=>({address,amount_atoms:'1'}))
}]});
await maxOutputBoundary.engine.refresh(address);
assert.match(maxOutputBoundary.nodes.get('.reference-data').textContent,/BOUNDED SOURCE/,
  'The exact 256-output boundary remains admissible');

const maxSupplyBoundary=fixture({transactions:[{
  ...transfer(49),
  outputs:[{address,amount_atoms:'1205000000000000'}]
}]});
await maxSupplyBoundary.engine.refresh(address);
assert.match(maxSupplyBoundary.nodes.get('.reference-data').textContent,/BOUNDED SOURCE/,
  'The configured 12.05M FAE atomic ceiling remains admissible');

const aboveSupply=fixture({transactions:[{
  ...transfer(50),
  outputs:[{address,amount_atoms:'1205000000000001'}]
}]});
await aboveSupply.engine.refresh(address);
assert.match(aboveSupply.nodes.get('.reference-data').textContent,/UNAVAILABLE/,
  'An output above configured supply must fail closed');

// Hostile /status metadata must not be coerced into a verified chain height.
for(const height of [null,'',true,'1e2','01',-1,'-1',1.5,Number.MAX_SAFE_INTEGER+1]){
  const hostile=fixture({status:{ok:true,height,network:'fairyelf-public-testnet-v4'}});
  await hostile.engine.refresh(address);
  assert.equal(hostile.nodes.get('.balance-value strong').textContent,'—','Unverified height must not show a balance: '+String(height));
  assert.deepEqual(hostile.urls.map(u=>u.slice(u.lastIndexOf('/')+1).split('?')[0]),['status'],
    'Invalid status must never request address-scoped data');
}
const crossNetwork=fixture({status:{ok:true,height:100,network:'different-network'}});
await crossNetwork.engine.refresh(address);
assert.equal(crossNetwork.nodes.get('.balance-value strong').textContent,'—');
assert.equal(crossNetwork.urls.length,1,'Wrong network must not request balance/history');
for(const status of [{ok:true,height:100},{ok:false,height:100,network:'fairyelf-public-testnet-v4'}]){
  const unbound=fixture({status});
  await unbound.engine.refresh(address);
  assert.equal(unbound.nodes.get('.balance-value strong').textContent,'—');
  assert.equal(unbound.urls.length,1,'Missing network or source acknowledgement must stop before address-scoped reads');
}
const canonicalNumericHeight=fixture({status:{ok:true,height:'100',network:'fairyelf-public-testnet-v4'}});
await canonicalNumericHeight.engine.refresh(address);
assert.equal(canonicalNumericHeight.nodes.get('.balance-value strong').textContent,'12.5',
  'Canonical decimal height string is accepted without numeric coercion ambiguity');

// Public route must remain fail-closed if it cannot complete before the deadline.
assert.match(source,/setTimeout\(\(\)=>ctl\.abort\(\),10000\)/);
assert.match(source,/clearTimeout\(deadline\)/);

const wrongAddress=fixture();
await wrongAddress.engine.refresh('invalid-address');
assert.deepEqual(wrongAddress.urls,[]);
assert.equal(wrongAddress.nodes.get('.balance-value strong').textContent,'—');
// A verified balance must not turn into an invented zero when only history fails.
const partial=fixture({historyFailure:true});
await partial.engine.refresh(address);
assert.equal(partial.nodes.get('.balance-value strong').textContent,'12.5');
assert.match(partial.nodes.get('.reference-data').textContent,/UNAVAILABLE/);

// A late response for Wallet A must never overwrite Wallet B after a switch.
// Deliberately ignore AbortSignal in the mock to exercise the epoch guard too.
function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done});
  return {promise,resolve};
}
const oldAddress='faet1'+'a'.repeat(31);
const newAddress='faet1'+'b'.repeat(31);
const oldBalance=deferred();
const oldHistory=deferred();
const oldSignals=[];
const switched=fixture({fetchOverride:async(url,{signal})=>{
  if(url.endsWith('/status'))return {ok:true,json:async()=>({ok:true,height:100,network:'fairyelf-public-testnet-v4'})};
  if(url.includes(encodeURIComponent(oldAddress))){
    oldSignals.push(signal);
    return url.includes('/balance?')?oldBalance.promise:oldHistory.promise;
  }
  assert.ok(url.includes(encodeURIComponent(newAddress)),'Unexpected public address in chain request');
  if(url.includes('/balance?'))return {ok:true,json:async()=>({ok:true,address:newAddress,balance_atoms:'525000000',balance_fae:'5.25'})};
  return {ok:true,json:async()=>({ok:true,transactions:[]})};
}});
const first=switched.engine.refresh(oldAddress);
for(let i=0;i<30&&switched.urls.length<3;i++)await new Promise(done=>setTimeout(done,0));
assert.equal(switched.urls.length,3,'Old Wallet reads must be in flight before switching');
const second=switched.engine.refresh(newAddress);
assert.equal(await second,true);
assert.equal(switched.nodes.get('.balance-value strong').textContent,'5.25');
assert.equal(oldSignals.length,2);
assert.ok(oldSignals.every(signal=>signal.aborted),'Superseded address reads must be aborted');
oldBalance.resolve({ok:true,json:async()=>({balance_fae:'999'})});
oldHistory.resolve({ok:true,json:async()=>({ok:true,transactions:[]})});
assert.equal(await first,false,'Stale read must not claim current success');
assert.equal(switched.nodes.get('.balance-value strong').textContent,'5.25',
  'Late old-address response contaminated the new Wallet balance');
assert.match(switched.nodes.get('.activity-list .list-head span').textContent,/NOT LIFETIME/);

// Explicit invalidation during a request must keep every old response unavailable.
const delayed=deferred();
const invalidated=fixture({fetchOverride:async(url)=>{
  if(url.endsWith('/status'))return {ok:true,json:async()=>({ok:true,height:100,network:'fairyelf-public-testnet-v4'})};
  return delayed.promise;
}});
const inFlight=invalidated.engine.refresh(oldAddress);
for(let i=0;i<30&&invalidated.urls.length<3;i++)await new Promise(done=>setTimeout(done,0));
assert.equal(invalidated.urls.length,3);
invalidated.engine.invalidate();
delayed.resolve({ok:true,json:async()=>({balance_fae:'8',transactions:[]})});
assert.equal(await inFlight,false);
assert.equal(invalidated.nodes.get('.balance-value strong').textContent,'—');
assert.match(invalidated.nodes.get('.reference-data').textContent,/UNAVAILABLE/);

console.log('Studio chain read PASS: network and address bound, partial outage, stale switch/invalidation, bounded history, zero safely distinguished');
