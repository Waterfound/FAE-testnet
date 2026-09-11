import {stableStringify} from './canonical.mjs';
import {cloneState,appendBlockFromSubmission,acceptTxInto,tip} from './fae-v4-core.mjs';
import {
  SHADOW_CODEC_STATUS,assertShadowCodecIsNonAuthoritative,
  projectCurrentV4BlockCandidate,encodeCurrentV4BlockShadow,decodeCurrentV4BlockShadow,
  projectCurrentV4Transaction,encodeCurrentV4TransactionShadow,decodeCurrentV4TransactionShadow
} from './consensus-v3-shadow-codec.mjs';

export const SHADOW_HARNESS_STATUS='dual-validation-observer-only';

function errorClass(error){return String(error?.code||error?.message||error||'unknown_error').split(':')[0]}
function run(operation){
  try{return{accepted:true,value:operation(),error:null,errorClass:null}}
  catch(error){return{accepted:false,value:null,error:String(error?.message||error),errorClass:errorClass(error)}}
}
function stateFingerprint(state){return stableStringify(state)}
function codecRoundTrip(encode,decode,value){
  try{
    const encoded=encode(value),decoded=decode(encoded);
    return{ok:true,encodedBytes:encoded.length,decoded,error:null,errorClass:null};
  }catch(error){return{ok:false,encodedBytes:null,decoded:null,error:String(error?.message||error),errorClass:errorClass(error)}}
}

export function shadowBlockParity(state,candidate,{activationHeight=undefined}={}){
  assertShadowCodecIsNonAuthoritative();
  const authoritative=run(()=>appendBlockFromSubmission(cloneState(state),candidate,{activationHeight}));
  const codec=codecRoundTrip(encodeCurrentV4BlockShadow,decodeCurrentV4BlockShadow,candidate);
  let shadow={accepted:false,value:null,error:codec.error,errorClass:codec.errorClass},semanticLossless=false,stateEqual=null;
  if(codec.ok){
    semanticLossless=stableStringify(projectCurrentV4BlockCandidate(candidate))===stableStringify(codec.decoded);
    shadow=run(()=>appendBlockFromSubmission(cloneState(state),codec.decoded,{activationHeight}));
    if(authoritative.accepted&&shadow.accepted)stateEqual=stateFingerprint(authoritative.value)===stateFingerprint(shadow.value);
  }
  const decisionParity=authoritative.accepted===shadow.accepted;
  const acceptedParity=authoritative.accepted?Boolean(codec.ok&&semanticLossless&&shadow.accepted&&stateEqual):decisionParity;
  return{
    kind:'block',status:SHADOW_HARNESS_STATUS,codecStatus:SHADOW_CODEC_STATUS,authoritative:{accepted:authoritative.accepted,errorClass:authoritative.errorClass,tipHash:authoritative.accepted?(tip(authoritative.value)?.hash??null):null},
    codec:{ok:codec.ok,encodedBytes:codec.encodedBytes,errorClass:codec.errorClass,semanticLossless},
    shadow:{accepted:shadow.accepted,errorClass:shadow.errorClass,tipHash:shadow.accepted?(tip(shadow.value)?.hash??null):null},
    decisionParity,errorParity:authoritative.accepted||!codec.ok?null:authoritative.errorClass===shadow.errorClass,stateEqual,parity:acceptedParity
  };
}

export function shadowTransactionParity(state,raw,{fromFeed=false}={}){
  assertShadowCodecIsNonAuthoritative();
  const authoritativeState=cloneState(state),authoritative=run(()=>acceptTxInto(authoritativeState,raw,{fromFeed}));
  const codec=codecRoundTrip(encodeCurrentV4TransactionShadow,decodeCurrentV4TransactionShadow,raw);
  let shadowState=cloneState(state),shadow={accepted:false,value:null,error:codec.error,errorClass:codec.errorClass},semanticLossless=false,stateEqual=null;
  if(codec.ok){
    semanticLossless=stableStringify(projectCurrentV4Transaction(raw))===stableStringify(codec.decoded);
    shadow=run(()=>acceptTxInto(shadowState,codec.decoded,{fromFeed}));
    if(authoritative.accepted&&shadow.accepted)stateEqual=stateFingerprint(authoritativeState)===stateFingerprint(shadowState);
  }
  const decisionParity=authoritative.accepted===shadow.accepted;
  const acceptedParity=authoritative.accepted?Boolean(codec.ok&&semanticLossless&&shadow.accepted&&stateEqual):decisionParity;
  return{
    kind:'transaction',status:SHADOW_HARNESS_STATUS,codecStatus:SHADOW_CODEC_STATUS,
    authoritative:{accepted:authoritative.accepted,errorClass:authoritative.errorClass,txid:authoritative.value?.txid??null,feeAtoms:authoritative.value?.fee_atoms??null},
    codec:{ok:codec.ok,encodedBytes:codec.encodedBytes,errorClass:codec.errorClass,semanticLossless},
    shadow:{accepted:shadow.accepted,errorClass:shadow.errorClass,txid:shadow.value?.txid??null,feeAtoms:shadow.value?.fee_atoms??null},
    decisionParity,errorParity:authoritative.accepted||!codec.ok?null:authoritative.errorClass===shadow.errorClass,stateEqual,parity:acceptedParity
  };
}

export function assertShadowParity(report,{requireErrorClass=false}={}){
  if(report?.status!==SHADOW_HARNESS_STATUS||report?.codecStatus!==SHADOW_CODEC_STATUS)throw new Error('shadow_harness_authority_guard_failed');
  if(!report.parity)throw new Error(`shadow_consensus_parity_mismatch:${report.kind}:${JSON.stringify(report)}`);
  if(report.authoritative.accepted&&(!report.codec.ok||!report.codec.semanticLossless||report.stateEqual!==true))throw new Error(`shadow_accepted_semantic_loss:${report.kind}`);
  if(requireErrorClass&&report.authoritative.accepted===false&&report.codec.ok&&report.errorParity!==true)throw new Error(`shadow_reject_error_class_mismatch:${report.kind}:${report.authoritative.errorClass}:${report.shadow.errorClass}`);
  return true;
}
