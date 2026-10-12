import {rehearseHeadersFirstSync} from './full-target-headers-sync-candidate.mjs';
import {validateBranchChain} from './activation-reorg-candidate.mjs';

export const ACTIVATION_NETWORK_COMPOSITION_STATUS='candidate-not-active-consensus';
export const PEER_VIEW_READY='READY';

function integer(value,label,{min=0}={}){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)throw new Error(`${label}_invalid`);return n}
function readinessState(view){if(typeof view==='string')return view;return String(view?.state??view?.peer_diversity?.state??'UNKNOWN')}
function tipOf(chain){return Array.isArray(chain)&&chain.length?chain.at(-1):null}

export function classifyActivationComposition({localChain,remoteChain,commonAncestorHeight,policy}={}){
  if(!Array.isArray(localChain)||!Array.isArray(remoteChain)||!policy)throw new Error('composition_chains_required');
  const ancestor=integer(commonAncestorHeight,'common_ancestor_height');
  const activation=integer(policy.activation_height,'activation_height',{min:1});
  const localHeight=Number(tipOf(localChain)?.height??0),remoteHeight=Number(tipOf(remoteChain)?.height??0);
  return Object.freeze({
    common_ancestor_height:ancestor,activation_height:activation,local_tip_height:localHeight,remote_tip_height:remoteHeight,
    partition_spans_activation:ancestor<activation&&(localHeight>=activation||remoteHeight>=activation),
    activation_crossing_reorg:ancestor<activation&&localHeight>=activation&&remoteHeight>=activation,
    local_regime:localHeight>=activation?'candidate':'legacy',remote_regime:remoteHeight>=activation?'candidate':'legacy'
  });
}

export async function evaluateActivationReconnect({
  localChain,commonAncestorHeight,remotePolicyDescriptor,remoteClaimedWork=null,remoteClaimedTipHash=null,
  fetchHeaders,fetchBlocks,policy,peerView,nowMs,clock=null
}={}){
  if(!Array.isArray(localChain)||!policy)throw new Error('composition_inputs_required');
  const readiness=readinessState(peerView),localTip=tipOf(localChain);
  // Network authority is intentionally evaluated before any remote fetch or
  // candidate validation. A stronger branch is not sufficient while the peer
  // view is eclipse/degraded HOLD.
  if(readiness!==PEER_VIEW_READY){
    const localReplay=validateBranchChain(localChain,policy,{enforceFutureDrift:false});
    return{
      ok:true,status:ACTIVATION_NETWORK_COMPOSITION_STATUS,peer_view_state:readiness,
      adoption_permitted:false,adopted:false,reason:'peer_view_not_ready',remote_touched:false,
      retained_tip_hash:localTip?.hash??null,retained_height:Number(localTip?.height??0),retained_work:localReplay.work
    };
  }
  const sync=await rehearseHeadersFirstSync({
    localChain,commonAncestorHeight,remotePolicyDescriptor,remoteClaimedWork,remoteClaimedTipHash,
    fetchHeaders,fetchBlocks,policy,nowMs,clock
  });
  if(!sync.ok)return{...sync,status:ACTIVATION_NETWORK_COMPOSITION_STATUS,peer_view_state:readiness,adoption_permitted:false,adopted:false,remote_touched:true};
  const selected=sync.preferred?sync.candidate_chain:localChain;
  const classification=classifyActivationComposition({localChain,remoteChain:sync.candidate_chain,commonAncestorHeight,policy});
  return{
    ...sync,status:ACTIVATION_NETWORK_COMPOSITION_STATUS,peer_view_state:readiness,
    adoption_permitted:true,adopted:sync.preferred,remote_touched:true,classification,
    selected_chain:selected,selected_tip_hash:tipOf(selected)?.hash??null,selected_height:Number(tipOf(selected)?.height??0)
  };
}
