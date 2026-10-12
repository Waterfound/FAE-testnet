import {
  BASE_SUPPLY_FAE,
  staticCandidate,
  monteCarloSummary,
} from './economic-block-time-v2-lab.mjs';

const candidates = [300, 600, 900];
const scenarios = ['stable', 'loss80', 'gain80', 'browserCycle'];
const runs = 256;
const durationDays = 14;
const durationSeconds = durationDays * 86400;

const daaProxy = [];
for (const targetSeconds of candidates) {
  for (const scenario of scenarios) {
    daaProxy.push(monteCarloSummary({
      targetSeconds,
      scenario,
      runs,
      durationSeconds,
    }));
  }
}

const report = {
  schema: 'fae-economic-block-time-v2-extended/1',
  authority: 'research-only-candidate-not-active-consensus',
  evidenceClass: 'seeded-stochastic-proxy-not-network-measurement',
  runsPerScenario: runs,
  durationDaysPerRun: durationDays,
  candidates,
  baselineTheoreticalSupplyFae: BASE_SUPPLY_FAE,
  staticMetrics: candidates.map(staticCandidate),
  daaProxy,
  interpretationGuard: {
    baselineDisposition: 'HOLD-300-AS-INCUMBENT',
    selectionAuthority: 'NONE',
    activationRule: 'L3_REQUIRED_BEFORE_ANY_TESTNET_ACTIVATION',
    warning: 'This report can reject weak hypotheses but cannot substitute for measured multi-node propagation/stale evidence.',
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
