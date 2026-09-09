'use strict';

(() => {
  const TRUST_KEY='fae-coordinator-trust-v1';
  const DESCRIPTOR_MAX_AGE_MS=10*60_000;
  const DESCRIPTOR_MAX_LIFETIME_MS=24*60*60_000;
  const MAX_ROTATION_CHAIN=32;
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
    const rotationSequence=pin.rotationSequence==null?0:Number(pin.rotationSequence);if(!Number.isSafeInteger(rotationSequence)||rotationSequence<0)throw trustError('Stored coordinator rotation sequence is malformed');
    if(pin.rotations!=null&&!Array.isArray(pin.rotations))throw trustError('Stored coordinator rotation history is malformed');
    return{...pin,rotationSequence,rotations:Array.isArray(pin.rotations)?pin.rotations:[]};
  }
  async function importEd25519Signer(signer,label){
    if(!signer?.id||!signer?.publicKey)throw trustError(label+' signer is incomplete');
    try{
      const publicKeyBytes=fb(signer.publicKey);if(bytesHex(await sh(publicKeyBytes))!==signer.id)throw trustError(label+' signer id mismatch');
      return{key:await crypto.subtle.importKey('spki',publicKeyBytes,{name:'Ed25519'},false,['verify']),publicKeyBytes};
    }catch(error){if(error?.code)throw error;throw trustError(label+' signer key is invalid')}
  }
  async function verifyEnvelopeSignature(envelope,label){
    if(!envelope?.signature)throw trustError(label+' signature is missing');
    const {key}=await importEd25519Signer(envelope.signer,label),signatureBytes=fb(envelope.signature),{signature,...signed}=envelope;
    if(!await crypto.subtle.verify({name:'Ed25519'},key,signatureBytes,E.encode(stable(signed))))throw trustError(label+' signature is invalid');
  }
  async function verifyDescriptorEnvelope(base,envelope){
    if(!envelope||envelope.domain!=='FAIRYELF_AUTH_V1'||envelope.version!==1||envelope.kind!=='coordinator-descriptor')throw trustError('Coordinator descriptor envelope is invalid');
    if(!envelope.signer?.id||!envelope.signer?.publicKey||!envelope.signature)throw trustError('Coordinator descriptor is incomplete');
    await verifyEnvelopeSignature(envelope,'Coordinator descriptor');
    const issued=Date.parse(envelope.issuedAt),age=Date.now()-issued;
    if(!Number.isFinite(issued)||age>DESCRIPTOR_MAX_AGE_MS||age<-60_000)throw trustError('Coordinator descriptor envelope timestamp is invalid');
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
  async function verifyRotationCertificate(base,certificate,{fromCoordinatorId,fromPublicKey,sequence}){
    if(!certificate||certificate.domain!=='FAIRYELF_AUTH_V1'||certificate.version!==1||certificate.kind!=='coordinator-rotation')throw trustError('Coordinator rotation certificate envelope is invalid');
    if(certificate.signer?.id!==fromCoordinatorId||certificate.signer?.publicKey!==fromPublicKey)throw trustError('Coordinator rotation is not signed by the currently trusted identity');
    await verifyEnvelopeSignature(certificate,'Coordinator rotation certificate');
    const envelopeIssued=Date.parse(certificate.issuedAt);if(!Number.isFinite(envelopeIssued)||envelopeIssued>Date.now()+60_000)throw trustError('Coordinator rotation certificate issuance time is invalid');
    const payload=certificate.payload;
    if(!payload||payload.rotationVersion!==1||payload.fromCoordinatorId!==fromCoordinatorId||payload.network!==NETWORK)throw trustError('Coordinator rotation certificate identity/network mismatch');
    if(normalizeCoordinatorUrl(payload.endpoint)!==base)throw trustError('Coordinator rotation certificate endpoint mismatch');
    if(Number(payload.sequence)!==Number(sequence)||!Number.isSafeInteger(Number(payload.sequence))||Number(payload.sequence)<1)throw trustError('Coordinator rotation certificate sequence mismatch');
    if(!/^[0-9a-f]{64}$/.test(String(payload.toCoordinatorId||''))||typeof payload.toPublicKey!=='string'||!payload.toPublicKey||payload.toCoordinatorId===fromCoordinatorId)throw trustError('Coordinator rotation target identity is invalid');
    let targetBytes;try{targetBytes=fb(payload.toPublicKey)}catch{throw trustError('Coordinator rotation target public key is invalid')}
    if(bytesHex(await sh(targetBytes))!==payload.toCoordinatorId)throw trustError('Coordinator rotation target id/public-key mismatch');
    const effective=Date.parse(payload.effectiveAt);if(!Number.isFinite(effective)||effective>Date.now()+60_000)throw trustError('Coordinator rotation is not yet effective');
    if(typeof payload.reason!=='string'||payload.reason.trim().length<8||payload.reason.trim().length>256)throw trustError('Coordinator rotation reason is invalid');
    return{sequence:Number(payload.sequence),fromCoordinatorId,pastPublicKey:fromPublicKey,toCoordinatorId:payload.toCoordinatorId,toPublicKey:payload.toPublicKey,effectiveAt:payload.effectiveAt,issuedAt:certificate.issuedAt,reason:payload.reason,certificate};
  }
  async function authorizeRotationChain(base,pin,chain,target){
    if(!Array.isArray(chain)||chain.length<1||chain.length>MAX_ROTATION_CHAIN)throw trustError('Coordinator identity changed without a bounded rotation chain');
    let currentId=pin.coordinatorId,currentPublicKey=pin.publicKey,sequence=pin.rotationSequence,history=[...pin.rotations];
    const relevant=chain.filter(certificate=>Number(certificate?.payload?.sequence)>sequence);
    if(!relevant.length)throw trustError('Coordinator rotation chain contains no new authorization');
    for(const certificate of relevant){
      const verified=await verifyRotationCertificate(base,certificate,{fromCoordinatorId:currentId,fromPublicKey:currentPublicKey,sequence:sequence+1});
      history.push({sequence:verified.sequence,fromCoordinatorId:verified.fromCoordinatorId,toCoordinatorId:verified.toCoordinatorId,issuedAt:verified.issuedAt,effectiveAt:verified.effectiveAt,reason:verified.reason});
      history=history.slice(-MAX_ROTATION_CHAIN);currentId=verified.toCoordinatorId;currentPublicKey=verified.toPublicKey;sequence=verified.sequence;
    }
    if(currentId!==target.coordinatorId||currentPublicKey!==target.publicKey)throw trustError('Coordinator rotation chain does not reach the presented descriptor identity');
    return{...pin,coordinatorId:currentId,publicKey:currentPublicKey,rotationSequence:sequence,rotations:history,lastSeenAt:new Date().toISOString()};
  }
  async function pinDescriptor(base,verified,rotationChain=[]){
    const store=readTrustStore(),existing=store[base];
    if(existing){
      const pin=validateStoredPin(base,existing);
      if(pin.coordinatorId===verified.coordinatorId&&pin.publicKey===verified.publicKey){store[base]={...pin,lastSeenAt:new Date().toISOString()}}
      else store[base]=await authorizeRotationChain(base,pin,rotationChain,verified);
    }else{
      const now=new Date().toISOString();store[base]={version:1,endpoint:base,coordinatorId:verified.coordinatorId,publicKey:verified.publicKey,firstSeenAt:now,lastSeenAt:now,rotationSequence:0,rotations:[]};
    }
    writeTrustStore(store);coordinatorIdentityByBase.set(base,store[base].coordinatorId);return store[base];
  }
  async function ensureCoordinatorTrust(base){
    const normalized=normalizeCoordinatorUrl(base);if(!normalized||normalized!==base)throw trustError('Coordinator trust endpoint is not canonical');
    const response=await rawCoordinatorApi(base,'/descriptor'),envelope=response?.descriptor??response,rotationChain=Array.isArray(response?.rotation_chain)?response.rotation_chain:[];
    const verified=await verifyDescriptorEnvelope(base,envelope),pin=await pinDescriptor(base,verified,rotationChain);
    return{...verified,pin};
  }

  coordinatorApi=async function trustedCoordinatorApi(base,path,options={}){
    if(path!=='/work')return rawCoordinatorApi(base,path,options);
    const trusted=await ensureCoordinatorTrust(base),work=await rawCoordinatorApi(base,path,options);
    if(work?.coordinatorId!==trusted.coordinatorId||work?.workProof?.signer?.id!==trusted.coordinatorId||work?.workProof?.signer?.publicKey!==trusted.publicKey)throw trustError('Coordinator work signer does not match the trusted descriptor');
    return work;
  };

  window.FAECoordinatorTrust=Object.freeze({trustKey:TRUST_KEY,ensure:ensureCoordinatorTrust,verifyDescriptor:verifyDescriptorEnvelope,readPins:()=>structuredClone(readTrustStore())});
})();
