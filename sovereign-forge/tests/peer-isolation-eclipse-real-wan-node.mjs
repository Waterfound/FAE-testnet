import {generateKeyPairSync} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {emptyState,appendBlockFromFeed} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';

function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
async function json(url,options={}){const response=await fetch(url,options),body=await response.json();if(!response.ok)throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);return body}
async function mine(base,address){const template=await json(`${base}/template?address=${encodeURIComponent(address)}`);let nonce=0,hash='';for(;nonce<10_000_000;nonce++){hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)break}if(nonce>=10_000_000)throw new Error('PoW search exhausted');await json(`${base}/submit-block`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:template.header,nonce,hash,txids:template.txids||[],coinbase_outputs:template.coinbase_outputs??null})});return hash}

const mode=process.argv[2]||'serve',role=String(process.env.FAE_WAN_ROLE||'ordinary'),port=Number(process.env.FAE_WAN_PORT||18787),dataDir=process.env.FAE_WAN_DATA_DIR||'/tmp/fae-eclipse-wan-node';
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('invalid FAE_WAN_PORT');
await mkdir(dataDir,{recursive:true});
const paths={dataFile:join(dataDir,'state.json'),identityFile:join(dataDir,'identity.json'),peerTrustFile:join(dataDir,'peer-trust.json')};

if(mode==='init-anchor'){
  const node=createAuthoritativeV4PeerNode({initialState:legacyState(),host:'127.0.0.1',port,...paths});
  await node.start();const address=wallet().address;await mine(node.baseUrl(),address);await mine(node.baseUrl(),address);const status=node.status();
  if(status.height!==13)throw new Error(`anchor initialization expected height 13, got ${status.height}`);
  console.log(JSON.stringify({event:'anchor-initialized',identityId:node.identity.id,height:status.height,tip_hash:status.tip_hash,port}));await node.close();process.exit(0);
}

if(mode!=='serve')throw new Error(`unknown mode: ${mode}`);
const options={host:'127.0.0.1',port,...paths};if(role!=='anchor')options.initialState=legacyState();
const node=createAuthoritativeV4PeerNode(options);await node.start();
console.log(JSON.stringify({event:'node-online',role,identityId:node.identity.id,height:node.status().height,tip_hash:node.status().tip_hash,port}));

let closing=false;
async function close(signal){if(closing)return;closing=true;try{await node.close()}finally{console.log(JSON.stringify({event:'node-offline',role,signal}));process.exit(0)}}
process.on('SIGTERM',()=>close('SIGTERM'));
process.on('SIGINT',()=>close('SIGINT'));
setInterval(()=>{},60_000);
