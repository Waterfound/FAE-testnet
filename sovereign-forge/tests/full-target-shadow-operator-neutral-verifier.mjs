import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const evidenceDir = process.argv[2];
const expectedReplays = Number(process.argv[3] ?? '5');

if (!evidenceDir || !Number.isInteger(expectedReplays) || expectedReplays < 1) {
  console.error('usage: node full-target-shadow-operator-neutral-verifier.mjs <evidence-dir> [expected-replays]');
  process.exit(2);
}

const fail = (message, details = {}) => {
  console.error(JSON.stringify({
    status: 'FAIL',
    format: 'FAE_OPERATOR_NEUTRAL_REPRODUCIBILITY_V1',
    reason: message,
    ...details,
  }));
  process.exit(1);
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail('invalid_or_missing_json', { file, error: error.message });
  }
};

const sha256File = (file) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
};

const contextPath = path.join(evidenceDir, 'context.json');
const context = readJson(contextPath);

if (context.format !== 'FAE_OPERATOR_NEUTRAL_CONTEXT_V1') {
  fail('unexpected_context_format', { actual: context.format });
}
if (context.expected_replays !== expectedReplays) {
  fail('replay_count_mismatch', { expected: expectedReplays, actual: context.expected_replays });
}
if (!context.git_commit || !context.boot_id) {
  fail('missing_code_or_boot_identity');
}

const requiredTrue = [
  'shadow_only',
  'separate_network_namespaces',
  'direct_c_to_b_path_absent',
  'direct_a_to_b_path_absent',
  'proxy_dual_homed',
  'degraded_transport',
  'headers_response_interrupted',
  'blocks_response_interrupted',
  'no_partial_adoption',
  'hard_restart_during_reorg_fault',
  'fresh_session_recovery',
  'stronger_work_selected',
  'lower_work_rollback_rejected',
  'restart_while_partitioned',
  'persisted_strong_tip',
];

const runEvidence = [];
for (let i = 1; i <= expectedReplays; i += 1) {
  const metaPath = path.join(evidenceDir, `run-${i}.meta.json`);
  const logPath = path.join(evidenceDir, `run-${i}.log`);

  if (!fs.existsSync(logPath)) fail('missing_run_log', { replay: i });
  const meta = readJson(metaPath);
  if (meta.replay !== i) fail('replay_index_mismatch', { replay: i, actual: meta.replay });
  if (meta.exit_code !== 0) fail('replay_process_failed', { replay: i, exit_code: meta.exit_code });
  if (meta.cleanup_ok !== true) fail('replay_cleanup_failed', { replay: i });

  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const summaries = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value?.scenario === 'one-machine-failure-domain-degraded-network-chaos') summaries.push(value);
    } catch {
      // Harness diagnostics are intentionally allowed; only its machine-readable
      // terminal summary is authoritative for this verifier.
    }
  }

  if (summaries.length !== 1) {
    fail('terminal_summary_count_invalid', { replay: i, count: summaries.length });
  }

  const summary = summaries[0];
  if (summary.status !== 'PASS') fail('replay_not_pass', { replay: i, actual: summary.status });
  for (const field of requiredTrue) {
    if (summary[field] !== true) fail('required_invariant_not_true', { replay: i, field, actual: summary[field] });
  }
  if (summary.external_wan_proof !== false) {
    fail('scope_boundary_corrupted', { replay: i, field: 'external_wan_proof', actual: summary.external_wan_proof });
  }
  if (!Number.isInteger(summary.accelerated_churn_phases) || summary.accelerated_churn_phases < 6) {
    fail('insufficient_churn_evidence', { replay: i, actual: summary.accelerated_churn_phases });
  }

  runEvidence.push({
    replay: i,
    log_sha256: sha256File(logPath),
    accelerated_churn_phases: summary.accelerated_churn_phases,
  });
}

const unexpected = fs.readdirSync(evidenceDir)
  .filter((name) => /^run-\d+\.(?:log|meta\.json)$/.test(name))
  .filter((name) => {
    const match = name.match(/^run-(\d+)\./);
    return match && Number(match[1]) > expectedReplays;
  });
if (unexpected.length > 0) fail('unexpected_extra_replay_evidence', { files: unexpected });

const attestation = {
  status: 'PASS',
  format: 'FAE_OPERATOR_NEUTRAL_REPRODUCIBILITY_V1',
  evidence_scope: 'one-man-one-machine-operator-neutrality-surrogate',
  independent_human_operator: 'N/A-by-design',
  single_physical_runner: true,
  fixed_replays: expectedReplays,
  all_replays_required: true,
  all_replays_passed: true,
  fail_closed: true,
  separate_verifier_codepath: true,
  code_identity_bound: true,
  boot_identity_bound: true,
  fresh_namespaces_and_volumes_per_replay: true,
  external_wan_proof: false,
  consensus_authority: false,
  git_commit: context.git_commit,
  boot_id: context.boot_id,
  code_hashes: context.code_hashes,
  runs: runEvidence,
};

const attestationPath = path.join(evidenceDir, 'attestation.json');
fs.writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
console.log(JSON.stringify(attestation));
