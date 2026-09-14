import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { freezeCampaign } from '../src/freeze.mjs';
import { runFrozenCampaign } from '../src/runner.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'fae-red-team-'));
const lock = await freezeCampaign(path.join(packageRoot, 'campaigns', 'fae-regression-smoke.v0.0.1.json'));
const report = await runFrozenCampaign(lock, { targetRoot: repositoryRoot });
await writeFile(path.join(temporary, 'campaign.lock.json'), JSON.stringify(lock, null, 2) + '\n');
await writeFile(path.join(temporary, 'run.report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  engine_version: '0.0.1',
  lock_digest: lock.lock_digest,
  report_digest: report.report_digest,
  gate: report.score.gate,
  score: report.score.total,
  counts: report.score.counts,
  evidence_directory: temporary
}, null, 2) + '\n');
if (report.score.gate === 'INVALID') process.exitCode = 2;
else if (report.score.gate === 'COLLAPSE') process.exitCode = 1;
