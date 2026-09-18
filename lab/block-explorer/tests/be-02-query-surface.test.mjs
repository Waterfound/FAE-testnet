import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createExplorerReader} from '../../../sovereign-forge/node/explorer-read.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const ZERO='0'.repeat(64);
const HASH1='1'.repeat(64);
const HASH2='2'.repeat(64);
const HASH3='3'.repeat(64);
const TXID=HASH2;
const ADDRESS='faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k';

function fixture(){
  return{
    format:'FAE_NODE_STATE_V1',
    network:NETWORK,
    chain:[
      {
        height:1,hash:HASH1,previous_hash:ZERO,timestamp_ms:1000,difficulty_bits:18,nonce:1,
        miner_address:ADDRESS,reward_atoms:'1000000000',
        header_json:{network:NETWORK,height:1,previous_hash:ZERO,timestamp_ms:1000,difficulty_bits:18,miner_address:ADDRESS,reward_atoms:'1000000000',nonce:1},
        txids:[]
      },
      {
        height:2,hash:HASH2,previous_hash:HASH1,timestamp_ms:2000,difficulty_bits:18,nonce:2,
        miner_address:ADDRESS,reward_atoms:'1000000000',
        header_json:{network:NETWORK,height:2,previous_hash:HASH1,timestamp_ms:2000,difficulty_bits:18,miner_address:ADDRESS,reward_atoms:'1000000000',nonce:2},
        txids:[TXID]
      }
    ],
    transactions:{
      [TXID]:{
        txid:TXID,network:NETWORK,from_address:ADDRESS,
        public_key_spki:'public-fixture',signature:'signature-fixture',
        inputs:[HASH1+':0'],
        outputs:[{address:ADDRESS,amount_atoms:'900000000'}],
        fee_atoms:'100000000',status:'confirmed',confirmed_height:2,mempool_seq:1,
        created_at:'2026-09-18T00:00:00.000Z'
      }
    },
    mempoolOrder:[],
    mempoolSeq:1,
    utxos:{
      [HASH1+':0']:{outpoint:HASH1+':0',address:ADDRESS,amount_atoms:'1000000000',created_height:1,spent:true,spent_by:TXID},
      [HASH2+':0']:{outpoint:HASH2+':0',address:ADDRESS,amount_atoms:'1000000000',created_height:2,spent:false,spent_by:null},
      [TXID+':0']:{outpoint:TXID+':0',address:ADDRESS,amount_atoms:'900000000',created_height:2,spent:false,spent_by:null}
    },
    mempoolSpends:{},
    mempoolOutputs:{}
  };
}

function formatAtoms(amount){
  const value=BigInt(amount),coin=100000000n,whole=value/coin;
  const fraction=(value%coin).toString().padStart(8,'0').replace(/0+$/,'');
  return fraction?`${whole}.${fraction}`:whole.toString();
}

function balanceAtoms(state,address){
  let total=0n;
  for(const output of Object.values(state.utxos))if(!output.spent&&output.address===address)total+=BigInt(output.amount_atoms);
  return total;
}

function publicBlock(block){
  return{
    height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),
    timestamp_ms:Number(block.timestamp_ms),difficulty_bits:Number(block.difficulty_bits),
    nonce:Number(block.nonce),miner_address:String(block.miner_address),
    reward_atoms:String(block.reward_atoms),header_json:block.header_json,txids:[...(block.txids||[])]
  };
}

function statusPayload(state){
  const tip=state.chain.at(-1)||null;
  const issued=state.chain.reduce((sum,block)=>sum+BigInt(block.reward_atoms),0n);
  return{
    ok:true,node_version:'test',network:NETWORK,height:tip?.height||0,tip_hash:tip?.hash||ZERO,
    difficulty_bits:18,target_seconds:180,issued_atoms:issued.toString(),issued_fae:formatAtoms(issued),
    max_supply_fae:'12000000',mempool_size:0,chain_work:'0'
  };
}

const reader=createExplorerReader({
  network:NETWORK,zeroHash:ZERO,statusPayload,publicBlock,
  validAddress:value=>value===ADDRESS,balanceAtoms,formatAtoms
});

function route(path,{method='GET',state=fixture()}={}){
  return reader.handle(method,new URL('http://localhost'+path),structuredClone(state));
}

test('status is bound to the exact observed validated tip',()=>{
  const result=route('/explorer/status');
  assert.equal(result.status,200);
  assert.equal(result.payload.network,NETWORK);
  assert.equal(result.payload.height,2);
  assert.equal(result.payload.tip_hash,HASH2);
  assert.equal(result.payload.observed_tip_height,2);
  assert.equal(result.payload.observed_tip_hash,HASH2);
  assert.equal(result.payload.issued_fae,'20');
});

test('latest blocks are newest-first and confirmations are tip-derived',()=>{
  const result=route('/explorer/blocks?limit=2');
  assert.equal(result.status,200);
  assert.deepEqual(result.payload.blocks.map(block=>block.height),[2,1]);
  assert.deepEqual(result.payload.blocks.map(block=>block.confirmations),[1,2]);
});

test('block lookup supports height and hash without namespace guessing',()=>{
  const byHeight=route('/explorer/block?height=1');
  const byHash=route('/explorer/block?hash='+HASH2);
  assert.equal(byHeight.payload.block.hash,HASH1);
  assert.equal(byHash.payload.block.height,2);
  assert.equal(route('/explorer/block?height=1&hash='+HASH1).status,400);
});

test('transaction detail exposes public transaction data but not signature material',()=>{
  const result=route('/explorer/transaction?txid='+TXID);
  assert.equal(result.status,200);
  assert.equal(result.payload.transaction.txid,TXID);
  assert.equal(result.payload.transaction.confirmations,1);
  assert.equal(result.payload.transaction.block_hash,HASH2);
  assert.equal('signature' in result.payload.transaction,false);
  assert.equal('public_key_spki' in result.payload.transaction,false);
});

test('address view includes both transfer and mining reward events',()=>{
  const result=route('/explorer/address?address='+ADDRESS);
  assert.equal(result.status,200);
  assert.equal(result.payload.balance_atoms,'1900000000');
  assert.equal(result.payload.balance_fae,'19');
  assert.equal(result.payload.total_events,3);
  assert.deepEqual(new Set(result.payload.events.map(event=>event.type)),new Set(['transfer','reward']));
  assert.equal(result.payload.events.filter(event=>event.type==='reward').length,2);
});

test('address cursor is bound to tip hash and fails closed after tip change',()=>{
  const first=route('/explorer/address?address='+ADDRESS+'&limit=1');
  assert.equal(first.status,200);
  assert.ok(first.payload.next_cursor?.startsWith(HASH2+':'));
  const changed=fixture();
  changed.chain.push({
    height:3,hash:HASH3,previous_hash:HASH2,timestamp_ms:3000,difficulty_bits:18,nonce:3,
    miner_address:ADDRESS,reward_atoms:'1000000000',header_json:{},txids:[]
  });
  const stale=route('/explorer/address?address='+ADDRESS+'&limit=1&cursor='+encodeURIComponent(first.payload.next_cursor),{state:changed});
  assert.equal(stale.status,503);
  assert.equal(stale.payload.error,'tip_changed_retry');
});

test('64-hex universal search checks block and transaction namespaces',()=>{
  const result=route('/explorer/search?q='+TXID);
  assert.equal(result.status,200);
  assert.deepEqual(result.payload.matches.map(match=>match.type).sort(),['block','transaction']);
});

test('search fails closed on malformed or absent objects',()=>{
  assert.equal(route('/explorer/search?q='+'A'.repeat(64)).status,400);
  assert.equal(route('/explorer/search?q=999').status,404);
  assert.equal(route('/explorer/transaction?txid='+'f'.repeat(64)).status,404);
});

test('Explorer namespace rejects mutating methods',()=>{
  const result=route('/explorer/status',{method:'POST'});
  assert.equal(result.status,405);
  assert.equal(result.payload.error,'read_only');
});

async function freePort(){
  return await new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}

async function waitFor(url,child){
  let lastError=null;
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw new Error('node exited early with '+child.exitCode);
    try{
      const response=await fetch(url);
      if(response.ok)return response;
    }catch(error){lastError=error}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw lastError||new Error('node did not start');
}

test('HTTP integration keeps Explorer read-only with GET/OPTIONS CORS',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-be02-'));
  const dataFile=join(dir,'state.json');
  await writeFile(dataFile,JSON.stringify(fixture()));
  const port=await freePort();
  const child=spawn(process.execPath,['sovereign-forge/node/fae-node.mjs'],{
    cwd:new URL('../../../',import.meta.url),
    env:{
      ...process.env,
      FAE_PORT:String(port),FAE_HOST:'127.0.0.1',FAE_DATA_FILE:dataFile,
      FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_BOOTSTRAP_FEEDS:'',FAE_PEERS:''
    },
    stdio:['ignore','pipe','pipe']
  });
  try{
    const base=`http://127.0.0.1:${port}`;
    await waitFor(base+'/explorer/status',child);
    const status=await fetch(base+'/explorer/status');
    assert.equal(status.status,200);
    assert.equal(status.headers.get('access-control-allow-methods'),'GET,OPTIONS');
    const payload=await status.json();
    assert.equal(payload.observed_tip_hash,HASH2);

    const mutation=await fetch(base+'/explorer/status',{method:'POST'});
    assert.equal(mutation.status,405);
    assert.equal(mutation.headers.get('access-control-allow-methods'),'GET,OPTIONS');

    const address=await fetch(base+'/explorer/address?address='+encodeURIComponent(ADDRESS));
    assert.equal(address.status,200);
    const addressPayload=await address.json();
    assert.equal(addressPayload.total_events,3);
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>{
      if(child.exitCode!==null)return resolve();
      child.once('exit',resolve);
      setTimeout(resolve,1000).unref();
    });
    await rm(dir,{recursive:true,force:true});
  }
});
