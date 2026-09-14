#!/usr/bin/env node
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { readJson } from './canonical.mjs';
import { freezeCampaign, verifyFrozenLock } from './freeze.mjs';
import { createBlindRequest, createHoldoutCommitments, retireHoldout, scoreHoldoutReveal } from './holdout.mjs';
import { promoteLearningProposal, proposeLearning } from './learning.mjs';
import { appendLearningEvent } from './ledger.mjs';
import { runMetaRedTeam } from './meta.mjs';
import { mutateAttack, proposeCrossDomainTransfers } from './mutation.mjs';
import { runFrozenCampaign } from './runner.mjs';

function parse(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error('Unexpected argument ' + token);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function required(options, key) {
  if (typeof options[key] !== 'string' || options[key].length === 0) throw new Error('--' + key + ' is required');
  return options[key];
}

async function writeNewJson(file, value, sensitive = false) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: sensitive ? 0o600 : 0o644
  });
  return absolute;
}

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function help() {
  output({
    engine: 'FAE Red Team Learning System',
    version: '0.0.1',
    commands: {
      freeze: '--campaign FILE [--out FILE]',
      verify: '--lock FILE',
      run: '--lock FILE --target-root DIR [--out FILE]',
      mutate: '--attack FILE --plan FILE --seed TEXT --count N [--out FILE]',
      transfer: '--attack FILE --map FILE [--out FILE]',
      learn: '--report FILE [--ledger FILE] [--out FILE]',
      promote: '--proposal FILE --review FILE --policy FILE [--out FILE]',
      'holdout-commit': '--private-set FILE --out FILE',
      'holdout-request': '--commitments FILE --out FILE',
      'holdout-score': '--commitments FILE --private-set FILE --submission FILE --out FILE',
      'holdout-retire': '--commitments FILE --review FILE --out FILE',
      meta: '[--root DIR] [--out FILE]'
    }
  });
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    help();
    return 0;
  }
  let result;
  let sensitive = false;
  if (command === 'freeze') {
    result = await freezeCampaign(required(options, 'campaign'));
  } else if (command === 'verify') {
    result = { valid: verifyFrozenLock(await readJson(required(options, 'lock'))) };
  } else if (command === 'run') {
    result = await runFrozenCampaign(await readJson(required(options, 'lock')), {
      targetRoot: required(options, 'target-root')
    });
  } else if (command === 'mutate') {
    result = mutateAttack(
      await readJson(required(options, 'attack')),
      await readJson(required(options, 'plan')),
      { seed: required(options, 'seed'), count: Number(options.count || 1) }
    );
  } else if (command === 'transfer') {
    result = proposeCrossDomainTransfers(
      await readJson(required(options, 'attack')),
      await readJson(required(options, 'map'))
    );
  } else if (command === 'learn') {
    result = proposeLearning(await readJson(required(options, 'report')));
    if (options.ledger) {
      for (const proposal of result) await appendLearningEvent(options.ledger, { kind: 'proposal', proposal });
    }
  } else if (command === 'promote') {
    result = promoteLearningProposal(
      await readJson(required(options, 'proposal')),
      await readJson(required(options, 'review')),
      await readJson(required(options, 'policy'))
    );
  } else if (command === 'holdout-commit') {
    result = createHoldoutCommitments(await readJson(required(options, 'private-set')));
  } else if (command === 'holdout-request') {
    result = createBlindRequest(await readJson(required(options, 'commitments')));
  } else if (command === 'holdout-score') {
    result = scoreHoldoutReveal(
      await readJson(required(options, 'commitments')),
      await readJson(required(options, 'private-set')),
      await readJson(required(options, 'submission'))
    );
    sensitive = true;
  } else if (command === 'holdout-retire') {
    result = retireHoldout(
      await readJson(required(options, 'commitments')),
      await readJson(required(options, 'review'))
    );
  } else if (command === 'meta') {
    result = await runMetaRedTeam({ root: options.root || path.resolve('.') });
  } else {
    throw new Error('Unknown command ' + command);
  }

  if (options.out) {
    const saved = await writeNewJson(options.out, result, sensitive);
    output({ saved, gate: result.gate || result.score?.gate || null });
  } else {
    output(result);
  }
  if (result.gate === 'INVALID' || result.score?.gate === 'INVALID') return 2;
  if (result.gate === 'COLLAPSE' || result.score?.gate === 'COLLAPSE') return 1;
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 2;
});
