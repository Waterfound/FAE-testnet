import path from 'node:path';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) output.push(absolute);
  }
  return output;
}

const sources = await files(root);
for (const source of sources) {
  await execute(process.execPath, ['--check', source], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
}
process.stdout.write('syntax ok: ' + sources.length + ' modules\n');
