import { spawn } from 'node:child_process';
import { sha256Text } from './canonical.mjs';
import { realInside } from './path-safety.mjs';

function runProcess(file, args, options) {
  return new Promise((resolve, reject) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let totalBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let spawnError = null;
    const stdout = [];
    const stderr = [];
    const child = spawn(file, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    function collect(chunk, list, stream) {
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, options.maxBuffer - totalBytes);
      if (remaining > 0) list.push(buffer.subarray(0, remaining));
      totalBytes += buffer.length;
      if (stream === 'stdout') stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      if (totalBytes > options.maxBuffer && !outputLimited) {
        outputLimited = true;
        child.kill('SIGKILL');
      }
    }

    child.stdout.on('data', (chunk) => collect(chunk, stdout, 'stdout'));
    child.stderr.on('data', (chunk) => collect(chunk, stderr, 'stderr'));
    child.on('error', (error) => {
      spawnError = error;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeout);
    timer.unref();

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const details = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        signal,
        stdoutBytes,
        stderrBytes
      };
      if (spawnError) {
        Object.assign(spawnError, details);
        reject(spawnError);
        return;
      }
      if (timedOut) {
        const error = Object.assign(new Error('Target process timed out'), details, { code: 'ETIMEDOUT', killed: true });
        reject(error);
        return;
      }
      if (outputLimited) {
        const error = Object.assign(new Error('Target process exceeded output limit'), details, {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          killed: true
        });
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(Object.assign(new Error('Target process exited with code ' + code), details));
        return;
      }
      resolve(details);
    });

    child.stdin.on('error', () => {});
    child.stdin.end(options.input === undefined ? undefined : options.input);
  });
}

function classifyError(error) {
  const outputLimited = error && (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(error.message || ''));
  const timedOut = error && error.code === 'ETIMEDOUT';
  const numericExit = Number.isInteger(error && error.code) ? error.code : null;
  if (outputLimited) return { outcome: 'engine_error', reason: 'output_limit' };
  if (timedOut) return { outcome: 'inconclusive', reason: 'timeout' };
  if (numericExit !== null) return { outcome: 'collapsed', reason: 'nonzero_exit' };
  return { outcome: 'engine_error', reason: 'spawn_failure' };
}

export async function executeAttack(attack, options) {
  const targetRoot = options.targetRoot;
  const cwd = await realInside(targetRoot, attack.executor.cwd);
  const argv = attack.executor.argv;
  const started = process.hrtime.bigint();
  const env = {
    PATH: process.env.PATH || '',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    CI: '1',
    FAE_RED_TEAM_MODE: 'research-only',
    FAE_RED_TEAM_NETWORK_POLICY: 'deny',
    FAE_RED_TEAM_ATTACK_ID: attack.id,
    FAE_RED_TEAM_SEED: options.seed
  };
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let signal = null;
  let outcome = 'engine_error';
  let reason = 'uninitialized';
  try {
    const result = await runProcess(argv[0], argv.slice(1), {
      cwd,
      timeout: attack.executor.timeout_ms,
      maxBuffer: attack.executor.max_output_bytes,
      env,
      input: attack.executor.stdin === 'payload-json' ? JSON.stringify(attack.payload || null) : undefined
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
    exitCode = attack.oracle.defended_exit_code;
    outcome = 'defended';
    reason = 'defensive_regression_passed';
  } catch (error) {
    stdout = error.stdout || '';
    stderr = error.stderr || error.message || '';
    exitCode = Number.isInteger(error.code) ? error.code : null;
    signal = error.signal || null;
    const classified = classifyError(error);
    outcome = classified.outcome;
    reason = classified.reason;
  }
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (exitCode !== null && exitCode === attack.oracle.defended_exit_code && outcome === 'collapsed') {
    outcome = 'defended';
    reason = 'defensive_regression_passed';
  }
  const evidence = {
    target_commit: options.targetCommit,
    attack_digest: attack.attack_digest,
    stdout_sha256: sha256Text(stdout),
    stderr_sha256: sha256Text(stderr),
    exit_code: exitCode,
    signal,
    duration_ms: Math.round(durationMs * 1000) / 1000
  };
  evidence.semantic_sha256 = sha256Text(JSON.stringify({
    outcome,
    reason,
    exit_code: exitCode,
    signal
  }));
  const evidenceComplete = attack.evidence_requirements.every((key) =>
    Object.prototype.hasOwnProperty.call(evidence, key) && evidence[key] !== undefined
  );
  return {
    attack_id: attack.id,
    repetition: options.repetition,
    domain: attack.domain,
    failure_class: attack.failure_class,
    severity: attack.severity,
    outcome,
    reason,
    evidence_complete: evidenceComplete,
    evidence,
    stdout_excerpt: null,
    stderr_excerpt: null
  };
}
