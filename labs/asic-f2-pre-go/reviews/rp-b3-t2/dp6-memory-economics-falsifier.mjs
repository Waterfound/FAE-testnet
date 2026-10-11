/**
 * FAE DP6 RP-B3-T3 — independent, source-bound conditional economic falsifier.
 * Research-only: NO specialist hardware cost measurement, throughput claim,
 * independent package quote, consensus change or mainnet approval.
 *
 * A conditional ceiling != achieved throughput or an ASIC lower cost bound.
 */
import {readFileSync} from 'node:fs';
const model=JSON.parse(readFileSync(new URL('../FAE_DP6_RP_B2_SPECIALIZED_PPA_ENVELOPE_MODEL.json',import.meta.url),'utf8'));
const terminal=JSON.parse(readFileSync(new URL('./RP_B3_T2B_SPECIALIZED_BOUND_TERMINAL.json',import.meta.url),'utf8'));
export const SOURCE=Object.freeze({
  contextBytes:model.source_constants.context_bytes,
  rw5Steps:model.source_constants.rw5_steps_per_work,
  fullMemoryTrafficLow:model.source_constants.full_memory_logical_traffic_low_bytes,
  fullMemoryTrafficHigh:model.source_constants.full_memory_logical_traffic_high_bytes,
  logicAreaMm2:terminal.logic_bound.full_cts_stdcell_area_mm2,
  logicStatisticalPowerW:terminal.logic_bound.full_cts_statistical_power_W,
  terminal:terminal.terminal_classification_refinement
});
function positive(name,v){if(!Number.isFinite(v)||v<=0)throw new Error('invalid_'+name);return v}
function nonnegative(name,v){if(!Number.isFinite(v)||v<0)throw new Error('invalid_'+name);return v}

/**
 * Context latency ceiling is CONDITIONAL on each RW5 dependent read's effective
 * latency and no more than 1 outstanding dependent read per resident context.
 * Bandwidth ceiling is CONDITIONAL on representative logical traffic.
 * Neither counts Argon, logic contention, DMA, bank inefficiency or scheduling.
 */
export function attackerFriendlyEnvelope({capacityBytes,dependentLatencyNs,
  sustainableBytesPerSecond,trafficBytesPerWork=SOURCE.fullMemoryTrafficLow}={}){
  positive('capacityBytes',capacityBytes);
  positive('dependentLatencyNs',dependentLatencyNs);
  positive('sustainableBytesPerSecond',sustainableBytesPerSecond);
  positive('trafficBytesPerWork',trafficBytesPerWork);
  if(trafficBytesPerWork<SOURCE.fullMemoryTrafficLow||trafficBytesPerWork>SOURCE.fullMemoryTrafficHigh)
    throw new Error('outside_frozen_traffic_range');
  const contexts=capacityBytes/SOURCE.contextBytes;
  const secondsPerWorkPerContext=SOURCE.rw5Steps*dependentLatencyNs*1e-9;
  const latencyCeiling=contexts/secondsPerWorkPerContext;
  const bandwidthCeiling=sustainableBytesPerSecond/trafficBytesPerWork;
  return {
    verdict:'CONDITIONAL_ATTACKER_FAVORABLE_CEILING__NOT_ACHIEVED_THROUGHPUT',
    source:SOURCE.terminal,
    residentContexts:contexts,
    latencyCeilingWorkPerSecond:latencyCeiling,
    bandwidthCeilingWorkPerSecond:bandwidthCeiling,
    combinedConditionalCeilingWorkPerSecond:Math.min(latencyCeiling,bandwidthCeiling),
    achievedThroughputProven:false,
    memoryAccessEfficiencyProven:false,
    installedPackageCostProven:false,
    specializationResistanceProven:false
  };
}
/**
 * Attacker cost comparison is a model, NOT an observed FAE ASIC cost.
 * Annualization is caller-supplied simple capex/lifetime and does NOT include
 * manufacturing/yield risks unless they were priced in the input.
 */
export function conditionalCostGap({
  specialistWorkPerSecond,installedCapexUSD,lifetimeYears,utilization,
  totalPowerW,electricityUSDPerKWh,variableOpexUSDPerWork=0,
  commodityUSDPerWork
}={}){
  for(const [n,v] of Object.entries({specialistWorkPerSecond,installedCapexUSD,
    lifetimeYears,totalPowerW,electricityUSDPerKWh,commodityUSDPerWork}))positive(n,v);
  nonnegative('variableOpexUSDPerWork',variableOpexUSDPerWork);
  if(!Number.isFinite(utilization)||utilization<=0||utilization>1)throw new Error('invalid_utilization');
  const annualWork=specialistWorkPerSecond*utilization*365.25*24*3600;
  const fixedPerWork=installedCapexUSD/(lifetimeYears*annualWork);
  const electricityPerWorkUSD=(totalPowerW/1000)*electricityUSDPerKWh/(specialistWorkPerSecond*3600);
  const costUSDPerWork=fixedPerWork+electricityPerWorkUSD+variableOpexUSDPerWork;
  return {
    verdict:'HYPOTHETICAL_ECONOMIC_COMPARISON__EXTERNAL_VERIFICATION_REQUIRED',
    modeledSpecialistUSDPerWork:costUSDPerWork,
    hypotheticalCommodityUSDPerWork:commodityUSDPerWork,
    specialistCheaperInThisScenario:costUSDPerWork<commodityUSDPerWork,
    specialistAdvantageRatioInThisScenario:commodityUSDPerWork/costUSDPerWork,
    actualASICCostVerified:false,
    actualCommodityCostVerified:false,
    mainnetEconomicVerdict:'EXTERNAL_EVIDENCE_GATE'
  };
}
export function terminalDecision({independentlyVerifiedSpecialistCost=false,
  independentlyVerifiedCommodityCost=false,randomIOEfficiencyVerified=false,
  installedPackageQuoteVerified=false}={}){
  const checks={independentlyVerifiedSpecialistCost,independentlyVerifiedCommodityCost,
    randomIOEfficiencyVerified,installedPackageQuoteVerified};
  // This module can't authenticate claimed values merely because a caller says
  // true; the target's independent verifier must bind external raw evidence.
  return {decision:'EXTERNAL_EVIDENCE_GATE',
    missing:Object.keys(checks).filter(k=>checks[k]!==true),
    evenIfClaimsSet:'PROVENANCE_AND_INDEPENDENT_SOURCE_AUTHENTICATION_REQUIRED',
    noImplicitPASSorCOLLAPSE:true,
    currentPremise:SOURCE.terminal
  };
}
