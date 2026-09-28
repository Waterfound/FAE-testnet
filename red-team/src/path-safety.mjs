import path from 'node:path';
import { realpath } from 'node:fs/promises';

export function lexicalInside(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(resolvedBase, candidate);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }
  throw new Error('Path escapes trusted root: ' + candidate);
}

export async function realInside(base, candidate) {
  const baseReal = await realpath(path.resolve(base));
  const candidateLexical = lexicalInside(baseReal, candidate);
  const candidateReal = await realpath(candidateLexical);
  const relative = path.relative(baseReal, candidateReal);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return candidateReal;
  }
  throw new Error('Resolved path escapes trusted root: ' + candidate);
}
