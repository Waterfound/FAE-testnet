/** Candidate-only FAE authored Element-to-product contract verifier. No network or secret access. */
export function validateBridge(x){
  const errors=[];
  const fail=(s)=>errors.push(s);
  const isText=s=>typeof s==="string"&&s.trim().length>0;
  if(x?.schema!=="FAE_AUTHORED_ELEMENT_PRODUCT_GATE_BRIDGE_V1")fail("schema");
  if(x?.admission!=="CANDIDATE_ONLY"||x?.mainnet_ready!==false||x?.production_wiring_authorized!==false||x?.merge_authorized!==false)fail("authority");
  if(!Array.isArray(x?.surfaces)||new Set(x.surfaces).size!==4||["mining","wallet","explorer","operations"].some(s=>!x.surfaces.includes(s)))fail("surfaces");
  const expectedGuards=["CONNECTED_NO_DEMO_FALLBACK","SYNTHETIC_STUDIO_ONLY","NO_WALLET_SECRETS_TO_PUBLIC_NODE","NO_IMPLICIT_WALLET_CREATION","UNKNOWN_NOT_ZERO","PENDING_NOT_CONFIRMED","NEXT_HEIGHT_NOT_MINING_PROGRESS","TIP_BOUND_COHERENCE","EVENT_DRIVEN_MOTION","REDUCED_MOTION_PARITY","FROZEN_ART_AUTHORITY_DISTINCT_FROM_MERGE","NO_MAINNET_WITHOUT_EXPLICIT_APPROVAL"];
  if(!Array.isArray(x?.universal_guards)||expectedGuards.some(y=>!x.universal_guards.includes(y)))fail("universal_guards");
  if(!x?.visual_authority||!["mining","wallet","explorer"].every(k=>isText(x.visual_authority[k])))fail("visual_authority");
  const knownElements=new Set(x?.owned_elements||[]), ids=new Set(), counts={mining:0,wallet:0,explorer:0,operations:0};
  if(!Array.isArray(x?.gates)||x.gates.length<12)fail("gates_count");
  for(const g of x?.gates||[]){
    if(!isText(g?.id)||ids.has(g.id))fail("duplicate_or_missing_gate_id"); else ids.add(g.id);
    if(!(g.surface in counts))fail("unknown_surface"); else counts[g.surface]++;
    if(!Array.isArray(g.elements)||g.elements.length===0||g.elements.some(n=>!knownElements.has(n)))fail("element_mapping:"+g.id);
    for(const k of ["source","meaning","missing","evidence","dependency"])if(!isText(g[k]))fail(k+":"+g.id);
    if(!["CANDIDATE_EVIDENCE","CONDITION_WAIT","HUMAN_GATE"].includes(g.status))fail("false_gate_closure:"+g.id);
  }
  for(const k of Object.keys(counts))if(counts[k]< (k==="operations"?3:3))fail("undercovered_surface:"+k);
  if(x?.candidate_verdict!=="BRIDGE_CONTRACT_TESTABLE__PRODUCT_DATA_AND_FINAL_FREEZE_GATES_OPEN")fail("verdict");
  return {ok:errors.length===0,errors,gate_count:x?.gates?.length||0,surface_gate_counts:counts};
}
