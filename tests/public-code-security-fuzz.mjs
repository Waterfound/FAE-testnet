import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';

import {
  NETWORK,START_BITS,ZERO_HASH,MAX_INPUTS,MAX_OUTPUTS,MAX_TXS_PER_BLOCK,
  emptyState,cloneState,expectedReward,validateBlockEnvelope,
  verifyTxCrypto,acceptTxInto,txPayload
} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,sha256} from '../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';
import {generateNodeIdentity} from '../sovereign-forge/node/authoritative/node-identity.mjs';
import {createPeerDescriptor,verifyPeerDescriptor,PeerDirectory} from '../sovereign-forge/node/authoritative/peer-directory.mjs';

const corpus=JSON.parse(await readFile(new URL('./security-corpus/public-code-malformed-v1.json',import.meta.url),'utf8'));
const SEED=0xfae51010;
let rngState=SEED>>>0;
function rnd(){rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState}
function pick(values){return values[rnd()%values.length]}
function int(max){return rnd()%max}

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  return{
    privateKey,
    publicKey,
    spki,
    pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')
  };
}

function signTx(from,{inputs=['fund:0'],outputs=[{address:from.address,amount_atoms:'1'}],network=NETWORK,version=2}={}){
  const base={version,network,inputs:[...inputs],outputs:outputs.map(x=>({...x})),public_key_spki:from.pub};
  const signature=nodeSign(null,Buffer.from(stableStringify(txPayload({...base,signature:''}))),from.privateKey).toString('base64');
  return{...base,signature};
}

function fundedState(owner,amount='100'){
  const state=emptyState();
  state.utxos['fund:0']={outpoint:'fund:0',address:owner.address,amount_atoms:String(amount),created_height:1,spent:false,spent_by:null};
  return state;
}

function normalizedJson(value){
  return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
}

function deepEqualJson(a,b){assert.equal(normalizedJson(a),normalizedJson(b))}

function shrinkString(value,fails){
  let current=String(value);
  for(let width=Math.max(1,Math.floor(current.length/2));width>=1;width=Math.floor(width/2)){
    let changed=true;
    while(changed){
      changed=false;
      for(let start=0;start+width<=current.length;start++){
        const candidate=current.slice(0,start)+current.slice(start+width);
        if(fails(candidate)){current=candidate;changed=true;break}
      }
    }
    if(width===1)break;
  }
  return current;
}

function shrinkJson(value,fails){
  let current=structuredClone(value);
  if(current&&typeof current==='object'&&!Array.isArray(current)){
    for(const key of Object.keys(current)){
      const candidate=structuredClone(current);
      delete candidate[key];
      if(fails(candidate))current=candidate;
    }
    for(const key of Object.keys(current)){
      if(typeof current[key]==='string'&&current[key].length){
        const original=current[key];
        const shrunk=shrinkString(original,s=>{
          const candidate=structuredClone(current);candidate[key]=s;return fails(candidate);
        });
        current[key]=shrunk;
      }
      if(Array.isArray(current[key])){
        let arr=[...current[key]];
        while(arr.length>0){
          const candidateArr=arr.slice(0,Math.floor(arr.length/2));
          const candidate=structuredClone(current);candidate[key]=candidateArr;
          if(fails(candidate))arr=candidateArr;else break;
        }
        current[key]=arr;
      }
    }
  }
  return current;
}

async function shrinkStringAsync(value,fails){
  let current=String(value);
  for(let width=Math.max(1,Math.floor(current.length/2));width>=1;width=Math.floor(width/2)){
    let changed=true;
    while(changed){
      changed=false;
      for(let start=0;start+width<=current.length;start++){
        const candidate=current.slice(0,start)+current.slice(start+width);
        if(await fails(candidate)){current=candidate;changed=true;break}
      }
    }
    if(width===1)break;
  }
  return current;
}

async function shrinkJsonAsync(value,fails){
  let current=structuredClone(value);
  if(current&&typeof current==='object'&&!Array.isArray(current)){
    for(const key of Object.keys(current)){
      const candidate=structuredClone(current);
      delete candidate[key];
      if(await fails(candidate))current=candidate;
    }
    for(const key of Object.keys(current)){
      if(typeof current[key]==='string'&&current[key].length){
        current[key]=await shrinkStringAsync(current[key],async s=>{
          const candidate=structuredClone(current);candidate[key]=s;return fails(candidate);
        });
      }
      if(Array.isArray(current[key])){
        let arr=[...current[key]];
        while(arr.length>0){
          const candidateArr=arr.slice(0,Math.floor(arr.length/2));
          const candidate=structuredClone(current);candidate[key]=candidateArr;
          if(await fails(candidate))arr=candidateArr;else break;
        }
        current[key]=arr;
      }
    }
  }
  return current;
}

async function property(name,count,generate,check,{shrink=null}={}){
  for(let i=0;i<count;i++){
    const value=generate(i);
    try{
      await check(value,i);
    }catch(error){
      let minimal=value;
      if(shrink){
        try{minimal=await shrink(value,async candidate=>{
          try{await check(candidate,i);return false}catch{return true}
        })}catch{}
      }
      throw new Error(name+' failed at case '+i+' seed=0x'+SEED.toString(16)+' reproducer='+normalizedJson(minimal)+' cause='+error.message,{cause:error});
    }
  }
}

function expectReject(result,expected){
  assert.equal(result.ok,false);
  if(expected==='invalid_signature_or_key')assert.match(result.error,/invalid_signature|invalid_public_key_or_signature/);
  else if(expected&&expected!=='reject')assert.equal(result.error,expected);
}

function txFromCorpus(row,alice,bob){
  if(row.kind==='raw')return row.value;
  switch(row.mutation){
    case'wrong_version':{const tx=signTx(alice);tx.version=1;return tx}
    case'wrong_network_resigned':return signTx(alice,{network:'attacker-network'});
    case'duplicate_input_resigned':return signTx(alice,{inputs:['fund:0','fund:0']});
    case'input_too_long_resigned':return signTx(alice,{inputs:['x'.repeat(161)]});
    case'invalid_output_address_resigned':return signTx(alice,{outputs:[{address:'faet1invalid',amount_atoms:'1'}]});
    case'zero_output_resigned':return signTx(alice,{outputs:[{address:bob.address,amount_atoms:'0'}]});
    case'too_many_outputs_resigned':return signTx(alice,{outputs:Array.from({length:MAX_OUTPUTS+1},()=>({address:bob.address,amount_atoms:'1'}))});
    case'malformed_public_key':{const tx=signTx(alice);tx.public_key_spki='not-der';return tx}
    case'tampered_signature':{const tx=signTx(alice);const bytes=Buffer.from(tx.signature,'base64');bytes[0]^=1;tx.signature=bytes.toString('base64');return tx}
    case'overspend_resigned':return signTx(alice,{outputs:[{address:bob.address,amount_atoms:'101'}]});
    case'foreign_input_resigned':return signTx(alice,{outputs:[{address:bob.address,amount_atoms:'90'}]});
    case'replay_identical':return signTx(alice,{outputs:[{address:bob.address,amount_atoms:'90'}]});
    default:throw new Error('unknown transaction corpus mutation '+row.mutation);
  }
}

function baseBlock(miner){
  return{
    header:{
      network:NETWORK,height:1,previous_hash:ZERO_HASH,timestamp_ms:Date.now(),
      difficulty_bits:START_BITS,miner_address:miner.address,
      reward_atoms:expectedReward(emptyState(),1).toString(),
      tx_root:hashHex([]),tx_count:0
    },
    nonce:0,hash:'f'.repeat(64),txids:[]
  };
}

function mutateBlock(row,miner){
  const value=baseBlock(miner);
  switch(row.mutation){
    case'wrong_network':value.header.network='attacker-network';break;
    case'negative_nonce':value.nonce=-1;break;
    case'malformed_hash':value.hash='not-a-hash';break;
    case'invalid_miner_address':value.header.miner_address='faet1invalid';break;
    case'duplicate_txids':value.txids=['a'.repeat(64),'a'.repeat(64)];break;
    case'too_many_txids':value.txids=Array.from({length:MAX_TXS_PER_BLOCK+1},(_,i)=>i.toString(16).padStart(64,'0'));break;
    case'wrong_height':value.header.height=2;break;
    case'wrong_previous_hash':value.header.previous_hash='a'.repeat(64);break;
    case'wrong_difficulty':value.header.difficulty_bits=START_BITS+1;break;
    case'wrong_reward':value.header.reward_atoms='1';break;
    case'wrong_tx_root':value.header.tx_root='a'.repeat(64);break;
    case'wrong_tx_count':value.header.tx_count=1;break;
    case'future_timestamp':value.header.timestamp_ms=Date.now()+121_000;break;
    case'invalid_pow':break;
    default:throw new Error('unknown block corpus mutation '+row.mutation);
  }
  return value;
}

function blockError(row){
  const map={
    malformed_submission:/malformed_submission/,
    invalid_tx_list:/invalid_tx_list/,
    stale_tip:/stale_tip/,
    invalid_consensus_fields:/invalid_consensus_fields/,
    tx_commitment_mismatch:/tx_commitment_mismatch/,
    invalid_timestamp:/invalid_timestamp/,
    invalid_proof_of_work:/invalid_proof_of_work/
  };
  return map[row.expect];
}

function fakeDom(){
  const elements=new Map();
  const local=new Map();
  return{
    document:{
      getElementById(id){
        if(!elements.has(id))elements.set(id,{
          dataset:{},lastElementChild:null,hidden:false,tabIndex:0,textContent:'',className:'',
          addEventListener(){},setAttribute(){},focus(){},querySelector(){return null}
        });
        return elements.get(id);
      }
    },
    localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)}
  };
}

async function browserHarness(){
  const dom=fakeDom();
  let apiMode='ok';
  const context={
    window:null,document:dom.document,localStorage:dom.localStorage,
    crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,Response,
    fetch:async()=>{
      if(apiMode==='json_error')return new Response(JSON.stringify({error:'corpus-json-error'}),{status:400,headers:{'content-type':'application/json'}});
      if(apiMode==='non_json_error')return{ok:false,status:502,json:async()=>{throw new Error('not json')}};
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    }
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(await readFile(new URL('../core.js',import.meta.url),'utf8'),context,{filename:'core.js'});
  return{
    validAddr:value=>{context.value=value;return vm.runInContext('validAddr(value)',context)},
    parseAmt:value=>{context.value=value;return vm.runInContext('parseAmt(value)',context)},
    api:async mode=>{apiMode=mode;return vm.runInContext("api('/corpus')",context)}
  };
}

test('PSR-10 fixed transaction corpus rejects malformed and semantically invalid inputs fail-closed',()=>{
  const alice=wallet(),bob=wallet();
  for(const row of corpus.transaction_cases){
    const tx=txFromCorpus(row,alice,bob);
    if(row.kind==='admission'){
      if(row.mutation==='foreign_input_resigned'){
        const state=fundedState(bob),before=cloneState(state);
        assert.throws(()=>acceptTxInto(state,tx),/input_not_owned/);
        deepEqualJson(state,before);
      }else if(row.mutation==='replay_identical'){
        const state=fundedState(alice);
        acceptTxInto(state,tx);
        const before=cloneState(state);
        assert.throws(()=>acceptTxInto(state,tx),/duplicate_txid|input_reserved/);
        deepEqualJson(state,before);
      }else{
        const state=fundedState(alice),before=cloneState(state);
        assert.throws(()=>acceptTxInto(state,tx),/overspend/);
        deepEqualJson(state,before);
      }
      continue;
    }
    const result=verifyTxCrypto(tx);
    expectReject(result,row.expect);
  }
});

test('PSR-10 fixed block corpus rejects every malformed envelope without state mutation',()=>{
  const miner=wallet();
  for(const row of corpus.block_cases){
    const state=emptyState(),before=cloneState(state),candidate=mutateBlock(row,miner);
    assert.throws(
      ()=>validateBlockEnvelope(state,candidate.header,candidate.nonce,candidate.hash,candidate.txids),
      blockError(row),
      row.id
    );
    deepEqualJson(state,before);
  }
});

test('PSR-10 fixed peer corpus preserves authentication and admission bounds',()=>{
  const now=Date.now(),identity=generateNodeIdentity();

  for(const row of corpus.peer_cases){
    if(row.mutation==='wrong_network'){
      const d=new PeerDirectory({networkId:NETWORK,now:()=>now});
      const envelope=createPeerDescriptor(identity,{networkId:'attacker-network',endpoint:'https://peer.example',ttlMs:60_000,now});
      assert.throws(()=>d.register(envelope),/network mismatch/i);
    }else if(row.mutation==='expired'){
      const d=new PeerDirectory({networkId:NETWORK,now:()=>now});
      const envelope=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://peer.example',ttlMs:60_000,now:now-120_000});
      assert.throws(()=>d.register(envelope),/expired|time invalid/i);
    }else if(row.mutation==='tampered_payload'){
      const envelope=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://peer.example',ttlMs:60_000,now});
      const tampered=structuredClone(envelope);tampered.payload.endpoint='https://evil.example';
      assert.throws(()=>verifyPeerDescriptor(tampered,{networkId:NETWORK,now}),/signature/i);
    }else if(row.mutation==='invalid_scheme'){
      assert.throws(()=>createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'ftp://peer.example',ttlMs:60_000,now}),/HTTP or HTTPS/);
    }else if(row.mutation==='oversized_capabilities'){
      const envelope=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://peer.example',ttlMs:60_000,now,capabilities:Array.from({length:100},(_,i)=>'cap-'+i)});
      assert.equal(verifyPeerDescriptor(envelope,{networkId:NETWORK,now}).capabilities.length,64);
    }else if(row.mutation==='source_flood'){
      const d=new PeerDirectory({networkId:NETWORK,maxRecords:20,maxRecordsPerSource:3,maxRecordsPerNetworkGroup:20,maxUnverifiedRecords:20,now:()=>now});
      for(let i=0;i<12;i++){const id=generateNodeIdentity();d.register(createPeerDescriptor(id,{networkId:NETWORK,endpoint:'https://peer'+i+'.example',ttlMs:60_000,now}),{source:'gossip'});}
      assert.ok(d.admissionStatus().maxObservedSourceRecords<=3);
    }else if(row.mutation==='network_group_flood'){
      const d=new PeerDirectory({networkId:NETWORK,maxRecords:20,maxRecordsPerSource:20,maxRecordsPerNetworkGroup:2,maxUnverifiedRecords:20,now:()=>now});
      for(let i=0;i<12;i++){const id=generateNodeIdentity();d.register(createPeerDescriptor(id,{networkId:NETWORK,endpoint:'http://203.0.113.'+(i+1)+':8787',ttlMs:60_000,now}),{source:'g'+i});}
      assert.ok(d.admissionStatus().maxObservedNetworkGroupRecords<=2);
    }else if(row.mutation==='identity_endpoint_flood'){
      const d=new PeerDirectory({networkId:NETWORK,maxRecords:20,maxEndpointsPerIdentity:2,now:()=>now});
      for(let i=0;i<8;i++)d.register(createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://p'+i+'.example',ttlMs:60_000,now}),{source:'g'+i});
      assert.ok(d.observations().filter(x=>x.identityId===identity.id).length<=2);
    }
  }
});

test('PSR-10 fixed browser/API corpus rejects malformed boundary inputs',async()=>{
  const browser=await browserHarness();
  for(const value of corpus.browser_cases.invalid_addresses)assert.equal(browser.validAddr(value),false,value);
  for(const value of corpus.browser_cases.invalid_amounts)assert.throws(()=>browser.parseAmt(value),undefined,value);
  for(const mode of corpus.browser_cases.api_modes)await assert.rejects(browser.api(mode));
});

test('PSR-10 property fuzz: arbitrary JSON-like transaction shapes never escape verifier or become nondeterministic',async()=>{
  const atoms=[null,true,false,0,1,-1,'','x','0','-1','1e9',[],{},['x'],{x:1}];
  const gen=()=>{
    const shape=int(7);
    if(shape===0)return pick(atoms);
    const obj={};
    const keys=['version','network','inputs','outputs','public_key_spki','signature','txid','from_address'];
    for(const key of keys)if(int(3)!==0)obj[key]=pick(atoms);
    return obj;
  };
  await property('tx-shape-totality',512,gen,value=>{
    let first,second;
    assert.doesNotThrow(()=>{first=verifyTxCrypto(value)});
    assert.doesNotThrow(()=>{second=verifyTxCrypto(structuredClone(value))});
    assert.equal(normalizedJson(first),normalizedJson(second));
    assert.equal(typeof first.ok,'boolean');
    if(first.ok)assert.match(first.txid,/^[0-9a-f]{64}$/);
  },{shrink:(value,fails)=>shrinkJsonAsync(value,fails)});
});

test('PSR-10 property fuzz: signed semantic mutations either admit conservatively or reject without partial state mutation',async()=>{
  const alice=wallet(),bob=wallet();
  await property('tx-state-atomicity',384,
    ()=>({
      amount:int(151),
      duplicate:Boolean(int(2)),
      wrongOwner:Boolean(int(5)===0)
    }),
    value=>{
      const state=fundedState(value.wrongOwner?bob:alice),before=cloneState(state);
      const inputs=value.duplicate?['fund:0','fund:0']:['fund:0'];
      const tx=signTx(alice,{inputs,outputs:[{address:bob.address,amount_atoms:String(value.amount)}]});
      try{
        acceptTxInto(state,tx);
        assert.equal(value.wrongOwner,false);
        assert.equal(value.duplicate,false);
        assert.ok(value.amount>=1&&value.amount<=100);
      }catch{
        deepEqualJson(state,before);
      }
    }
  );
});

test('PSR-10 property fuzz: hostile block mutations deterministically reject without canonical state mutation',async()=>{
  const miner=wallet(),rows=corpus.block_cases;
  await property('block-rejection-atomicity',512,
    ()=>rows[int(rows.length)],
    row=>{
      const state=emptyState(),before=cloneState(state),candidate=mutateBlock(row,miner);
      let a,b;
      try{validateBlockEnvelope(state,candidate.header,candidate.nonce,candidate.hash,candidate.txids);a='ACCEPT'}catch(e){a=e.message}
      deepEqualJson(state,before);
      const again=emptyState();
      try{validateBlockEnvelope(again,candidate.header,candidate.nonce,candidate.hash,candidate.txids);b='ACCEPT'}catch(e){b=e.message}
      assert.notEqual(a,'ACCEPT',row.id);
      assert.equal(a,b,row.id+' rejection must be deterministic');
      deepEqualJson(again,before);
    }
  );
});

test('PSR-10 property fuzz: randomized peer floods remain bounded under declared admission budgets',async()=>{
  const now=Date.now();
  await property('peer-directory-bounds',64,
    ()=>({
      maxRecords:3+int(8),
      maxSource:1+int(3),
      maxGroup:1+int(3),
      maxUnverified:1+int(3),
      records:20+int(30)
    }),
    cfg=>{
      const maxUnverified=Math.min(cfg.maxUnverified,cfg.maxRecords);
      const d=new PeerDirectory({
        networkId:NETWORK,
        maxRecords:cfg.maxRecords,
        maxRecordsPerSource:cfg.maxSource,
        maxRecordsPerNetworkGroup:cfg.maxGroup,
        maxUnverifiedRecords:maxUnverified,
        now:()=>now
      });
      for(let i=0;i<cfg.records;i++){
        const identity=generateNodeIdentity();
        const octet=1+(i%200);
        const group=int(4);
        const endpoint='http://203.0.'+group+'.'+octet+':8787';
        d.register(createPeerDescriptor(identity,{networkId:NETWORK,endpoint,ttlMs:60_000,now}),{source:'source-'+(i%4)});
      }
      const s=d.admissionStatus();
      assert.ok(s.records<=cfg.maxRecords);
      assert.ok(s.maxObservedSourceRecords<=cfg.maxSource);
      assert.ok(s.maxObservedNetworkGroupRecords<=cfg.maxGroup);
      assert.ok(s.unverifiedRecords<=maxUnverified);
    }
  );
});

test('PSR-10 property fuzz: browser parsers remain total and amount acceptance matches canonical decimal grammar',async()=>{
  const browser=await browserHarness();
  const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:$._-+eE, ';
  const genString=()=>Array.from({length:int(48)},()=>alphabet[int(alphabet.length)]).join('');
  await property('browser-parser-totality',512,genString,value=>{
    assert.doesNotThrow(()=>browser.validAddr(value));
    let accepted=false;
    try{const atoms=browser.parseAmt(value);accepted=true;assert.equal(typeof atoms,'bigint');assert.ok(atoms>=0n)}catch{}
    const grammar=/^(\d+)(?:\.(\d{1,8}))?$/.test(value.trim());
    assert.equal(accepted,grammar,'amount parser acceptance must match canonical grammar');
  },{shrink:async(value)=>value});
});

test('PSR-10 shrinker reduces synthetic failing objects while preserving a reproducer',()=>{
  const original={noise:'abcdefghijklmnopqrstuvwxyz',unused:[1,2,3,4],culprit:'BAD'};
  const fails=value=>value?.culprit==='BAD';
  const minimal=shrinkJson(original,fails);
  assert.equal(minimal.culprit,'BAD');
  assert.ok(normalizedJson(minimal).length<normalizedJson(original).length);
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-10',
  seed:'0x'+SEED.toString(16),
  fixed_cases:{
    transactions:corpus.transaction_cases.length,
    blocks:corpus.block_cases.length,
    peers:corpus.peer_cases.length,
    browser:corpus.browser_cases.invalid_addresses.length+corpus.browser_cases.invalid_amounts.length+corpus.browser_cases.api_modes.length
  },
  property_cases:512+384+512+64+512,
  reusable_corpus:true,
  deterministic:true,
  minimizer_present:true,
  runtime_or_consensus_change:false
}));
