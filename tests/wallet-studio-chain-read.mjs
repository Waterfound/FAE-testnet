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
    if(url.endsWith('/status'))return {ok:true,json:async()=>({height:100,network:'fairyelf-public-testnet-v4'})};
    if(url.includes('/balance?')){
      if(options.networkFailure)throw Error('offline');
      return {ok:true,json:async()=>({balance_fae:options.balance??'12.5'})};
    }
    if(url.includes('/transactions?')){
      if(options.historyFailure)throw Error('offline');
      return {ok:true,json:async()=>({transactions:options.transactions??[]})};
    }
    throw Error('unrecognized route');
  };
  const window={};
  runInNewContext(transactionAdapter,{window,globalThis:window,Date,BigInt,Object});
  runInNewContext(source,{window,document,fetch,AbortController,BigInt,Promise});
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

const invalid=fixture({balance:'NaN'});
await invalid.engine.refresh(address);
assert.equal(invalid.nodes.get('.balance-value strong').textContent,'—');

const wrongAddress=fixture();
await wrongAddress.engine.refresh('invalid-address');
assert.deepEqual(wrongAddress.urls,[]);
assert.equal(wrongAddress.nodes.get('.balance-value strong').textContent,'—');
console.log('Studio chain read PASS: public only, network bound, confirmed-vs-unavailable, bounded history, zero safely distinguished');
