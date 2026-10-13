import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE,attackerFriendlyEnvelope,conditionalCostGap,terminalDecision,randomBankServiceSensitivity}
  from './dp6-memory-economics-falsifier.mjs';
const near=(x,y,relative=0.002)=>assert.ok(Math.abs(x-y)/y<relative,`expected ${x} near ${y}`);
test('RP-B3-T3-01: frozen source semantics and logic facts are bound, not presumed from 256 MiB alone',()=>{
  assert.equal(SOURCE.contextBytes,268435456);
  assert.equal(SOURCE.rw5Steps,1048576);
  assert.equal(SOURCE.fullMemoryTrafficLow,553648128);
  assert.equal(SOURCE.fullMemoryTrafficHigh,822083584);
  assert.equal(SOURCE.logicAreaMm2,0.0856683);
  assert.match(SOURCE.terminal,/MEMORY_ECONOMIC_BOUND_OPEN/);
});
test('RP-B3-T3-02: HBM4 attacker-friendly, conditional latency and bandwidth ceilings are reproducible',()=>{
  const inputs={capacityBytes:36e9,dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12};
  const loose=attackerFriendlyEnvelope(inputs);
  const tight=attackerFriendlyEnvelope({...inputs,trafficBytesPerWork:SOURCE.fullMemoryTrafficHigh});
  near(loose.residentContexts,134.11045);
  near(loose.latencyCeilingWorkPerSecond,1724);
  near(loose.bandwidthCeilingWorkPerSecond,5057);
  near(tight.bandwidthCeilingWorkPerSecond,3406);
  assert.equal(loose.achievedThroughputProven,false);
  assert.equal(loose.specializationResistanceProven,false);
  assert.equal(tight.combinedConditionalCeilingWorkPerSecond,tight.latencyCeilingWorkPerSecond);
  assert.equal(loose.mainnetEconomicVerdict,undefined);
});
test('RP-B3-T3-03: latency sensitivity binds achievable *ceiling*, cannot be misreported as achieved hardware rate',()=>{
  const common={capacityBytes:36e9,sustainableBytesPerSecond:2.8e12};
  const a=attackerFriendlyEnvelope({...common,dependentLatencyNs:50});
  const b=attackerFriendlyEnvelope({...common,dependentLatencyNs:150});
  near(a.latencyCeilingWorkPerSecond/b.latencyCeilingWorkPerSecond,3);
  assert.equal(a.verdict,'CONDITIONAL_ATTACKER_FAVORABLE_CEILING__NOT_ACHIEVED_THROUGHPUT');
  assert.equal(b.memoryAccessEfficiencyProven,false);
});
test('RP-B3-T3-04: invented financial assumptions can reverse result; neither direction proves FAE robustness',()=>{
  const base={specialistWorkPerSecond:100,lifetimeYears:3,utilization:0.8,
    totalPowerW:400,electricityUSDPerKWh:0.15,commodityUSDPerWork:0.0001};
  const cheap=conditionalCostGap({...base,installedCapexUSD:100000});
  const expensive=conditionalCostGap({...base,installedCapexUSD:2000000});
  assert.equal(cheap.specialistCheaperInThisScenario,true);
  assert.equal(expensive.specialistCheaperInThisScenario,false);
  for(const p of [cheap,expensive]){
    assert.equal(p.mainnetEconomicVerdict,'EXTERNAL_EVIDENCE_GATE');
    assert.equal(p.actualASICCostVerified,false);
    assert.equal(p.actualCommodityCostVerified,false);
  }
});
test('RP-B3-T3-05: fail closed on zero/negative/nonphysical input and unsupported memory traffic',()=>{
  const base={capacityBytes:36e9,dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12};
  assert.throws(()=>attackerFriendlyEnvelope({...base,dependentLatencyNs:0}),/invalid_dependentLatencyNs/);
  assert.throws(()=>attackerFriendlyEnvelope({...base,capacityBytes:-1}),/invalid_capacityBytes/);
  assert.throws(()=>attackerFriendlyEnvelope({...base,trafficBytesPerWork:8}),/outside_frozen_traffic_range/);
  const costs={specialistWorkPerSecond:100,installedCapexUSD:1000,lifetimeYears:3,utilization:0.8,totalPowerW:400,electricityUSDPerKWh:0.2,commodityUSDPerWork:1};
  assert.throws(()=>conditionalCostGap({...costs,utilization:1.5}),/invalid_utilization/);
  assert.throws(()=>conditionalCostGap({...costs,commodityUSDPerWork:-1}),/invalid_commodityUSDPerWork/);
});
test('RP-B3-T3-06: a JSON claim of verified external evidence never self-authenticates into PASS',()=>{
  const none=terminalDecision();
  assert.equal(none.decision,'EXTERNAL_EVIDENCE_GATE');
  assert.equal(none.missing.length,4);
  const alleged=terminalDecision({independentlyVerifiedSpecialistCost:true,independentlyVerifiedCommodityCost:true,
    randomIOEfficiencyVerified:true,installedPackageQuoteVerified:true});
  assert.equal(alleged.decision,'EXTERNAL_EVIDENCE_GATE');
  assert.deepEqual(alleged.missing,[]);
  assert.equal(alleged.noImplicitPASSorCOLLAPSE,true);
});

test('RP-B3-T3-07: bank-service scenario can bind HBM latency+capacity without claiming achieved throughput',()=>{
 const base={capacityBytes:36e9,dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12,
   effectiveBanks:64,randomBankServiceNs:75,bankTransactionsPerStep:2};
 const scenario=randomBankServiceSensitivity(base);
 const expected=64/(1048576*2*75e-9);
 near(scenario.bankRateUpperBoundWorkPerSecond,expected,1e-10);
 assert.ok(scenario.bankRateUpperBoundWorkPerSecond<scenario.contextAndBandwidthCeilingWorkPerSecond);
 assert.equal(scenario.combinedConditionalCeilingWorkPerSecond,scenario.bankRateUpperBoundWorkPerSecond);
 assert.equal(scenario.observedDependentBankService,false);
 assert.equal(scenario.observedAddressTraceDistribution,false);
 assert.equal(scenario.achievedSpecialistThroughput,false);
 assert.equal(scenario.specialistEconomicsVerdict,'EXTERNAL_EVIDENCE_GATE');
});
test('RP-B3-T3-08: conditional banking throughput improves with assumed banks but is not proof of an ASIC',()=>{
 const fixed={capacityBytes:36e9,dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12,
   randomBankServiceNs:75,bankTransactionsPerStep:2};
 const a=randomBankServiceSensitivity({...fixed,effectiveBanks:32});
 const b=randomBankServiceSensitivity({...fixed,effectiveBanks:128});
 near(b.bankRateUpperBoundWorkPerSecond/a.bankRateUpperBoundWorkPerSecond,4,1e-10);
 const degraded=randomBankServiceSensitivity({...fixed,effectiveBanks:128,bankUtilization:0.25});
 near(degraded.bankRateUpperBoundWorkPerSecond,a.bankRateUpperBoundWorkPerSecond,1e-10);
 assert.equal(b.specialistEconomicsVerdict,'EXTERNAL_EVIDENCE_GATE');
});
test('RP-B3-T3-09: incompatible banking hypotheses fail closed rather than masquerade as sourced measurements',()=>{
 const base={capacityBytes:36e9,dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12,
    randomBankServiceNs:75,effectiveBanks:64};
 for(const invalid of [{effectiveBanks:0},{effectiveBanks:1.5},{effectiveBanks:1e7},
   {randomBankServiceNs:0},{bankTransactionsPerStep:0},{bankTransactionsPerStep:33},
   {bankUtilization:0},{bankUtilization:1.1}]){
   const input={...base,...invalid};
   assert.throws(()=>randomBankServiceSensitivity(input),/invalid_/);
 }
});

test('RP-B3-T3-10: partial 256 MiB state is not a physically resident DP6 work context',()=>{
  const base={dependentLatencyNs:74.1885,sustainableBytesPerSecond:2.8e12};
  for(const capacityBytes of [1,1024,128*1024*1024,SOURCE.contextBytes-1]){
    assert.throws(()=>attackerFriendlyEnvelope({...base,capacityBytes}),
      /insufficient_resident_dp6_context/);
    assert.throws(()=>randomBankServiceSensitivity({...base,capacityBytes,
      effectiveBanks:64,randomBankServiceNs:75}),/insufficient_resident_dp6_context/);
  }
  const exact=attackerFriendlyEnvelope({...base,capacityBytes:SOURCE.contextBytes});
  assert.equal(exact.residentContexts,1);
  assert.ok(exact.combinedConditionalCeilingWorkPerSecond>0);
  assert.equal(exact.achievedThroughputProven,false);
  assert.equal(exact.specializationResistanceProven,false);
});
test('RP-B3-T3-11: slightly super-capacity remains attacker-favorable but not an achieved fraction of a context',()=>{
  const base={capacityBytes:SOURCE.contextBytes+1,dependentLatencyNs:74.1885,
    sustainableBytesPerSecond:2.8e12};
  const r=attackerFriendlyEnvelope(base);
  assert.ok(r.residentContexts>1&&r.residentContexts<1.000001,
    'continuous-capacity ceiling intentionally favors attacker at a full resident context');
  assert.equal(r.achievedThroughputProven,false);
  assert.equal(r.memoryAccessEfficiencyProven,false);
});

test('RP-B3-T3-12: finite but extreme hypotheses cannot overflow a specialist cost advantage',()=>{
  const assumptions={specialistWorkPerSecond:100,installedCapexUSD:100000,
    lifetimeYears:3,utilization:0.8,totalPowerW:400,
    electricityUSDPerKWh:0.15,commodityUSDPerWork:0.0001};
  assert.throws(()=>conditionalCostGap({...assumptions,specialistWorkPerSecond:1e308}),
    /invalid_derived_cost_economics/);
  assert.throws(()=>conditionalCostGap({...assumptions,commodityUSDPerWork:1e308,
    specialistWorkPerSecond:1e10}),/invalid_derived_cost_economics/);
  const sound=conditionalCostGap(assumptions);
  assert.ok(Number.isFinite(sound.specialistAdvantageRatioInThisScenario));
  assert.equal(sound.mainnetEconomicVerdict,'EXTERNAL_EVIDENCE_GATE');
});
test('RP-B3-T3-13: underflowed time or bank service cannot be treated as achievable DP6 throughput',()=>{
  const assumptions={capacityBytes:SOURCE.contextBytes,dependentLatencyNs:75,
    sustainableBytesPerSecond:2.8e12};
  assert.throws(()=>attackerFriendlyEnvelope({...assumptions,dependentLatencyNs:Number.MIN_VALUE}),
    /invalid_derived_hardware_ceiling/);
  assert.throws(()=>randomBankServiceSensitivity({...assumptions,effectiveBanks:64,
    randomBankServiceNs:Number.MIN_VALUE}),/invalid_derived_bank_ceiling/);
  const valid=randomBankServiceSensitivity({...assumptions,effectiveBanks:64,randomBankServiceNs:75});
  assert.ok(Number.isFinite(valid.combinedConditionalCeilingWorkPerSecond));
  assert.equal(valid.specialistEconomicsVerdict,'EXTERNAL_EVIDENCE_GATE');
});
