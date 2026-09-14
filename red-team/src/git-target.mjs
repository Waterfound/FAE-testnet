import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const COMMIT = /^[a-f0-9]{40}$/;

async function git(root, args) {
  const result = await run('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: process.env.PATH || '',
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC'
    }
  });
  return result.stdout.trim();
}

export async function inspectGitTarget(root) {
  const repositoryRoot = await git(root, ['rev-parse', '--show-toplevel']);
  const commit = await git(repositoryRoot, ['rev-parse', 'HEAD^{commit}']);
  const status = await git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!COMMIT.test(commit)) throw new Error('Target HEAD is not a full Git commit');
  return {
    repository_root: repositoryRoot,
    commit,
    clean: status.length === 0,
    status_lines: status.length === 0 ? [] : status.split('\n')
  };
}

export async function resolveGitRef(root, ref) {
  const resolved = await git(root, ['rev-parse', ref + '^{commit}']);
  if (!COMMIT.test(resolved)) throw new Error('Target ref did not resolve to a full Git commit');
  return resolved;
}
