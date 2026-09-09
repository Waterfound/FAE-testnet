'use strict';

(() => {
  const TRUST_KEY='fae-coordinator-trust-v1';
  const DESCRIPTOR_MAX_AGE_MS=10*60_000;
  const DESCRIPTOR_MAX_LIFETIME_MS=24*60*60_000;
  const rawCoordinatorApi=coordinatorApi;

  function trustError(message){return protocolError(message,'COORDINATOR_TRUST')}
  function readTrustStore(){
    let raw;
    try{raw=localStorage.getItem(TRUST_KEY)}catch{throw trustError('Persistent coordinator trust storage is unavailable')}
    if(raw==null)return{};
    let parsed;
    try{parsed=JSON.parse(raw)}catch{throw trustError('Persistent coordinator trust store is malformed')}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw trustError('Persistent coordinator trust store is malformed');
    return parsed;
  }
  function writeTrustStore(store){
    const encoded=JSON.stringify(store);
    try{localStorage.setItem(TRUST_KEY,encoded);if(localStorage.getItem(TRUST_KEY)!==encoded)throw new Error('readback mismatch')}
    catch{throw trustError('Persistent coordinator trust storage could not be committed')}
  }
  function validateStoredPin(base,pin){
    if(!pin||typeof pin!=='object'||pin.endpoint!==base||!/^[0-9a-f]{64}$/.test(String(pin.coordinatorId||''))||typeof pin.publicKey!=='string'||!pin.publicKey)throw trustError('Stored coordinator trust pin is malformed');
    return pin;
  }
  async function verifyDescriptorEnvelope(base,envelope){
    if(!envelope||envelope.domain!=='FAIRYELF_AUTH_V1'||envelope.version!==1||envelope.kind!=='coordinator-descriptor')throw trustError('Coordinator descriptor envelope is invalid');
    if(!envelope.signer?.id||!envelope.signer?.publicKey||!envelope.signature)throw trustError('Coordinator descriptor is incomplete');
    let publicKeyBytes,signatureBytes,key;
    try{
      publicKeyBytes=fb(envelope.signer.publicKey);signatureBytes=fb(envelope.signature);
      if(bytesHex(await sh(publicKeyBytes))!==envelope.signer.id)throw trustError('Coordinator descriptor signer id mismatch');
      key=await crypto.subtle.importKey('spki',publicKeyBytes,{name:'Ed25519'},false,['verify']);
    }catch(error){if(error?.code)throw error;throw trustError('Coordinator descriptor signer key is invalid')}
    const issued=Date.parse(envelope.issuedAt),age=Date.now()-issued;
    if(!Number.isFinite(issued)||age>DESCRIPTOR_MAX_AGE_MS||age<-60_000)throw trustError('Coordinator descriptor envelope timestamp is invalid');
    const {signature,...signed}=envelope;
    if(!await crypto.subtle.verify({name:'Ed25519'},key,signatureBytes,E.encode(stable(signed))))throw trustError('Coordinator descriptor signature is invalid');
    const payload=envelope.payload;
    if(!payload||payload.descriptorVersion!==1||payload.type!=='fairyelf-share-coordinator'||payload.coordinatorId!==envelope.signer.id)throw trustError('Coordinator descriptor identity is invalid');
    if(payload.network!==NETWORK||payload.mode!=='pplns-direct-pay')throw trustError('Coordinator descriptor network or mode mismatch');
    const endpoint=normalizeCoordinatorUrl(payload.endpoint);if(endpoint!==base)throw trustError('Coordinator descriptor endpoint mismatch');
    const payloadIssued=Date.parse(payload.issuedAt),validUntil=Date.parse(payload.validUntil);
    if(!Number.isFinite(payloadIssued)||!Number.isFinite(validUntil)||payloadIssued>Date.now()+60_000||validUntil<=Date.now()||validUntil-payloadIssued<=0||validUntil-payloadIssued>DESCRIPTOR_MAX_LIFETIME_MS)throw trustError('Coordinator descriptor validity window is invalid');
    if(Math.abs(payloadIssued-issued)>5_000)throw trustError('Coordinator descriptor issuance times are inconsistent');
    if(!Number.isSafeInteger(Number(payload.windowSize))||Number(payload.windowSize)<1||Number(payload.windowSize)>100_000)throw trustError('Coordinator descriptor window size is invalid');
    if(!Number.isSafeInteger(Number(payload.shareDifficultyDelta))||Number(payload.shareDifficultyDelta)<1||Number(payload.shareDifficultyDelta)>20)throw trustError('Coordinator descriptor share difficulty is invalid');
    if(payload.upstreamNodeIdentity!=null&&!/^[0-9a-f]{64}$/.test(String(payload.upstreamNodeIdentity)))throw trustError('Coordinator descriptor upstream identity is invalid');
    return{coordinatorId:envelope.signer.id,publicKey:envelope.signer.publicKey,endpoint:base,payload,envelope};
  }
  function pinDescriptor(base,verified){
    const store=readTrustStore(),existing=store[base];
    if(existing){
      const pin=validateStoredPin(base,existing);
      if(pin.coordinatorId!==verified.coordinatorId||pin.publicKey!==verified.publicKey)throw trustError('Coordinator identity changed since first trusted contact');
      store[base]={...pin,lastSeenAt:new Date().toISOString()};
    }else{
      const now=new Date().toISOString();
      store[base]={version:1,endpoint:base,coordinatorId:verified.coordinatorId,publicKey:verified.publicKey,firstSeenAt:now,lastSeenAt:now};
    }
    writeTrustStore(store);
    coordinatorIdentityByBase.set(base,verified.coordinatorId);
    return store[base];
  }
  async function ensureCoordinatorTrust(base){
    const normalized=normalizeCoordinatorUrl(base);if(!normalized||normalized!==base)throw trustError('Coordinator trust endpoint is not canonical');
    const response=await rawCoordinatorApi(base,'/descriptor');
    const envelope=response?.descriptor??response;
    const verified=await verifyDescriptorEnvelope(base,envelope),pin=pinDescriptor(base,verified);
    return{...verified,pin};
  }

  coordinatorApi=async function trustedCoordinatorApi(base,path,options={}){
    if(path!=='/work')return rawCoordinatorApi(base,path,options);
    const trusted=await ensureCoordinatorTrust(base);
    const work=await rawCoordinatorApi(base,path,options);
    if(work?.coordinatorId!==trusted.coordinatorId||work?.workProof?.signer?.id!==trusted.coordinatorId||work?.workProof?.signer?.publicKey!==trusted.publicKey)throw trustError('Coordinator work signer does not match the trusted descriptor');
    return work;
  };

  window.FAECoordinatorTrust=Object.freeze({trustKey:TRUST_KEY,ensure:ensureCoordinatorTrust,verifyDescriptor:verifyDescriptorEnvelope,readPins:()=>structuredClone(readTrustStore())});
})();
