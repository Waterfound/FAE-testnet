import {createCipheriv,createDecipheriv,createHash,createPublicKey,diffieHellman,generateKeyPairSync,hkdfSync,randomBytes} from 'node:crypto';
import {stableStringify} from './canonical.mjs';
import {signEnvelope,verifyEnvelope} from './node-identity.mjs';

export const SECURE_CHANNEL_DOMAIN='FAIRYELF_SECURE_CHANNEL_V1';
const CHANNEL_VERSION=1;
const DEFAULT_TTL_MS=10*60_000;
const DEFAULT_MAX_SESSIONS=512;
const DEFAULT_MAX_MESSAGE_BYTES=2*1024*1024;
const MAX_SEQUENCE=Number.MAX_SAFE_INTEGER;
const identityContextBindings=new WeakMap();

function strictBase64(value,label){
  if(typeof value!=='string'||value.length===0||value.length>4_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error(`Malformed ${label}`);
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value)throw new Error(`Non-canonical ${label}`);
  return bytes;
}
function normalizeContextBinding(value){
  if(value===null||value===undefined||value==='')return null;
  const binding=String(value).toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(binding))throw new Error('Secure-channel context binding must be a 32-byte hex digest');
  return binding;
}
function ephemeralKeyPair(){
  const {privateKey,publicKey}=generateKeyPairSync('x25519');
  return {privateKey,publicKey:publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
function x25519PublicKey(value){
  const key=createPublicKey({key:strictBase64(value,'X25519 public key'),type:'spki',format:'der'});
  if(key.asymmetricKeyType!=='x25519')throw new Error('Secure channel requires an X25519 public key');
  return key;
}
function transcriptHash(transcript){return createHash('sha256').update(stableStringify(transcript)).digest()}
function deriveKeys(privateKey,remotePublicKey,transcript){
  const sharedSecret=diffieHellman({privateKey,publicKey:x25519PublicKey(remotePublicKey)});
  const salt=transcriptHash(transcript);
  const c2s=Buffer.from(hkdfSync('sha256',sharedSecret,salt,`${SECURE_CHANNEL_DOMAIN}/client-to-server`,32));
  const s2c=Buffer.from(hkdfSync('sha256',sharedSecret,salt,`${SECURE_CHANNEL_DOMAIN}/server-to-client`,32));
  sharedSecret.fill(0); return {c2s,s2c};
}
function aad({network,sessionId,direction,sequence}){
  return Buffer.from(stableStringify({domain:SECURE_CHANNEL_DOMAIN,version:CHANNEL_VERSION,network,sessionId,direction,sequence}));
}
function seal(key,context,message,maxMessageBytes){
  const plaintext=Buffer.from(stableStringify(message));
  if(plaintext.length===0||plaintext.length>maxMessageBytes)throw new Error('Secure-channel message exceeds size ceiling');
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16}); cipher.setAAD(aad(context));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return {domain:SECURE_CHANNEL_DOMAIN,version:CHANNEL_VERSION,sessionId:context.sessionId,sequence:context.sequence,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function open(key,context,frame,maxMessageBytes){
  if(!frame||frame.domain!==SECURE_CHANNEL_DOMAIN||frame.version!==CHANNEL_VERSION)throw new Error('Malformed secure-channel frame');
  if(frame.sessionId!==context.sessionId||frame.sequence!==context.sequence)throw new Error('Secure-channel frame context mismatch');
  const iv=strictBase64(frame.iv,'secure-channel IV'),ciphertext=strictBase64(frame.ciphertext,'secure-channel ciphertext'),tag=strictBase64(frame.tag,'secure-channel authentication tag');
  if(iv.length!==12||tag.length!==16||ciphertext.length===0||ciphertext.length>maxMessageBytes)throw new Error('Malformed secure-channel cryptographic fields');
  const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16}); decipher.setAAD(aad(context)); decipher.setAuthTag(tag);
  let plaintext; try{plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()])}catch{throw new Error('Secure-channel authentication failed')}
  if(plaintext.length>maxMessageBytes)throw new Error('Secure-channel plaintext exceeds size ceiling');
  try{return JSON.parse(plaintext.toString('utf8'))}catch{throw new Error('Secure-channel plaintext is not valid JSON')}
}
function validateSequence(sequence){if(!Number.isSafeInteger(sequence)||sequence<0||sequence>MAX_SEQUENCE)throw new Error('Invalid secure-channel sequence')}
function handshakeTranscript({network,sessionId,challenge,clientIdentityId,serverIdentityId,clientEphemeralKey,serverEphemeralKey,expiresAt,contextBinding=null}){
  const transcript={domain:SECURE_CHANNEL_DOMAIN,version:CHANNEL_VERSION,network,sessionId,challenge,clientIdentityId,serverIdentityId,clientEphemeralKey,serverEphemeralKey,expiresAt};
  const binding=normalizeContextBinding(contextBinding);if(binding!==null)transcript.contextBinding=binding;return transcript;
}

export class SecureChannelHub{
  constructor({identity,networkId,ttlMs=DEFAULT_TTL_MS,maxSessions=DEFAULT_MAX_SESSIONS,maxMessageBytes=DEFAULT_MAX_MESSAGE_BYTES,now=()=>Date.now(),contextBinding=null}){
    if(!identity?.id||!identity?.privateKeyPem)throw new Error('Secure channel requires a node identity');
    this.identity=identity; this.networkId=networkId; this.ttlMs=ttlMs; this.maxSessions=maxSessions; this.maxMessageBytes=maxMessageBytes; this.now=now; this.sessions=new Map();this.contextBinding=normalizeContextBinding(contextBinding);identityContextBindings.set(identity,this.contextBinding);
  }
  forget(sessionId){const session=this.sessions.get(sessionId); if(!session)return; session.receiveKey.fill(0); session.sendKey.fill(0); this.sessions.delete(sessionId)}
  prune(reserve=0){const now=this.now(); for(const [sessionId,session] of this.sessions)if(session.expiresAt<=now)this.forget(sessionId); while(this.sessions.size+reserve>this.maxSessions)this.forget(this.sessions.keys().next().value)}
  destroy(){for(const sessionId of [...this.sessions.keys()])this.forget(sessionId)}
  accept(initEnvelope){
    this.prune(1);
    const init=verifyEnvelope(initEnvelope,{kind:'secure-channel-init',maxAgeMs:2*60_000});
    const clientIdentityId=initEnvelope.signer.id;
    if(init.network!==this.networkId)throw new Error('Secure-channel network mismatch');
    if(init.expectedServerId!==this.identity.id)throw new Error('Secure-channel server identity mismatch');
    const clientBinding=normalizeContextBinding(init.contextBinding??null);if(clientBinding!==this.contextBinding)throw new Error('Secure-channel context binding mismatch');
    if(!/^[0-9a-f]{64}$/.test(init.challenge??''))throw new Error('Secure-channel challenge is malformed');
    x25519PublicKey(init.clientEphemeralKey);
    const serverEphemeral=ephemeralKeyPair(),sessionId=randomBytes(32).toString('hex'),expiresAt=this.now()+this.ttlMs;
    const transcript=handshakeTranscript({network:this.networkId,sessionId,challenge:init.challenge,clientIdentityId,serverIdentityId:this.identity.id,clientEphemeralKey:init.clientEphemeralKey,serverEphemeralKey:serverEphemeral.publicKey,expiresAt,contextBinding:this.contextBinding});
    const keys=deriveKeys(serverEphemeral.privateKey,init.clientEphemeralKey,transcript);
    this.sessions.set(sessionId,{clientIdentityId,contextBinding:this.contextBinding,receiveKey:keys.c2s,sendKey:keys.s2c,nextSequence:0,expiresAt});
    return signEnvelope(this.identity,'secure-channel-accept',transcript);
  }
  openRequest(frame){
    this.prune();
    if(!frame||typeof frame.sessionId!=='string')throw new Error('Secure-channel session is missing');
    const session=this.sessions.get(frame.sessionId); if(!session)throw new Error('Unknown or expired secure-channel session');
    validateSequence(frame.sequence); if(frame.sequence!==session.nextSequence)throw new Error('Secure-channel replay or out-of-order request');
    const message=open(session.receiveKey,{network:this.networkId,sessionId:frame.sessionId,direction:'client-to-server',sequence:frame.sequence},frame,this.maxMessageBytes);
    session.nextSequence+=1; return {clientIdentityId:session.clientIdentityId,contextBinding:session.contextBinding,sessionId:frame.sessionId,sequence:frame.sequence,message};
  }
  sealResponse(openedRequest,message){
    const session=this.sessions.get(openedRequest.sessionId); if(!session)throw new Error('Unknown or expired secure-channel session');
    return seal(session.sendKey,{network:this.networkId,sessionId:openedRequest.sessionId,direction:'server-to-client',sequence:openedRequest.sequence},message,this.maxMessageBytes);
  }
  status(){this.prune(); return {activeSessions:this.sessions.size,maximumSessions:this.maxSessions,ttlMs:this.ttlMs,contextBinding:this.contextBinding}}
}

export class SecurePeerSession{
  constructor({baseUrl,networkId,sessionId,expiresAt,sendKey,receiveKey,maxMessageBytes=DEFAULT_MAX_MESSAGE_BYTES,contextBinding=null}){
    this.baseUrl=baseUrl.replace(/\/$/,''); this.networkId=networkId; this.sessionId=sessionId; this.expiresAt=expiresAt; this.sendKey=sendKey; this.receiveKey=receiveKey; this.maxMessageBytes=maxMessageBytes;this.contextBinding=normalizeContextBinding(contextBinding);this.nextSequence=0;this.closed=false;
  }
  createRequest(path,{method='GET',body=null}={}){
    if(this.closed||Date.now()>=this.expiresAt)throw new Error('Secure peer session is closed or expired');
    if(typeof path!=='string'||!path.startsWith('/'))throw new Error('Secure peer request path is invalid');
    validateSequence(this.nextSequence); const sequence=this.nextSequence; this.nextSequence+=1;
    return {sequence,frame:seal(this.sendKey,{network:this.networkId,sessionId:this.sessionId,direction:'client-to-server',sequence},{method,path,body},this.maxMessageBytes)};
  }
  acceptResponse(frame,sequence){
    const response=open(this.receiveKey,{network:this.networkId,sessionId:this.sessionId,direction:'server-to-client',sequence},frame,this.maxMessageBytes);
    if(!response?.ok||!Number.isInteger(response.status))throw new Error(response?.body?.error??'Secure peer request failed');
    return response.body;
  }
  async request(path,init={}){
    const prepared=this.createRequest(path,init); let response;
    try{response=await fetch(`${this.baseUrl}/peer/secure`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(prepared.frame),signal:AbortSignal.timeout(8_000)})}catch(error){this.close(); throw error}
    let frame; try{frame=await response.json()}catch(error){this.close(); throw error}
    if(!response.ok){this.close(); throw new Error(frame.error??`Secure peer returned HTTP ${response.status}`)}
    try{return this.acceptResponse(frame,prepared.sequence)}catch(error){this.close(); throw error}
  }
  close(){if(this.closed)return; this.sendKey.fill(0); this.receiveKey.fill(0); this.closed=true}
}

export async function establishSecurePeerSession({baseUrl,identity,networkId,expectedServerId,contextBinding=undefined}){
  const binding=contextBinding===undefined?(identityContextBindings.get(identity)??null):normalizeContextBinding(contextBinding);
  const clientEphemeral=ephemeralKeyPair(),challenge=randomBytes(32).toString('hex');
  const initPayload={network:networkId,expectedServerId,challenge,clientEphemeralKey:clientEphemeral.publicKey};if(binding!==null)initPayload.contextBinding=binding;
  const initEnvelope=signEnvelope(identity,'secure-channel-init',initPayload);
  const response=await fetch(`${baseUrl.replace(/\/$/,'')}/peer/channel`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(initEnvelope),signal:AbortSignal.timeout(8_000)});
  const envelope=await response.json(); if(!response.ok)throw new Error(envelope.error??`Secure-channel handshake returned HTTP ${response.status}`);
  const accepted=verifyEnvelope(envelope,{kind:'secure-channel-accept',expectedSignerId:expectedServerId,maxAgeMs:2*60_000});
  if(accepted.domain!==SECURE_CHANNEL_DOMAIN||accepted.version!==CHANNEL_VERSION)throw new Error('Secure-channel acceptance version mismatch');
  if(accepted.network!==networkId||accepted.challenge!==challenge)throw new Error('Secure-channel acceptance transcript mismatch');
  if(accepted.clientIdentityId!==identity.id||accepted.serverIdentityId!==expectedServerId)throw new Error('Secure-channel acceptance identity mismatch');
  if(normalizeContextBinding(accepted.contextBinding??null)!==binding)throw new Error('Secure-channel acceptance context binding mismatch');
  if(accepted.clientEphemeralKey!==clientEphemeral.publicKey)throw new Error('Secure-channel acceptance changed the client key');
  if(!/^[0-9a-f]{64}$/.test(accepted.sessionId??'')||!Number.isSafeInteger(accepted.expiresAt)||accepted.expiresAt<=Date.now())throw new Error('Secure-channel acceptance has invalid session metadata');
  x25519PublicKey(accepted.serverEphemeralKey);
  const transcript=handshakeTranscript(accepted); if(stableStringify(transcript)!==stableStringify(accepted))throw new Error('Secure-channel acceptance contains an invalid transcript');
  const keys=deriveKeys(clientEphemeral.privateKey,accepted.serverEphemeralKey,transcript);
  return new SecurePeerSession({baseUrl,networkId,sessionId:accepted.sessionId,expiresAt:accepted.expiresAt,sendKey:keys.c2s,receiveKey:keys.s2c,contextBinding:binding});
}
