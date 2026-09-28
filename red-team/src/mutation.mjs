import { digestJson } from './canonical.mjs';
import { validateGenealogy } from './genealogy.mjs';
import { createRng } from './rng.mjs';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const STRING_EDGES = ['', '0', '\u0000', 'é', 'ｅ', 'a'.repeat(256)];

function parts(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('Mutation path must be a JSON pointer');
  if (!pointer.startsWith('/payload/')) throw new Error('Mutation may target only the attack payload');
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).map((part) => {
    if (FORBIDDEN.has(part)) throw new Error('Forbidden mutation path component');
    return part;
  });
}

function locate(root, pointer) {
  const path = parts(pointer);
  if (path.length === 0) throw new Error('Mutation path may not target document root');
  let parent = root;
  for (const key of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !(key in parent)) throw new Error('Mutation path not found: ' + pointer);
    parent = parent[key];
  }
  const key = path[path.length - 1];
  if (!parent || typeof parent !== 'object' || !(key in parent)) throw new Error('Mutation path not found: ' + pointer);
  return { parent, key };
}

function choose(values, random) {
  return values[Math.floor(random() * values.length)];
}

function applyOperator(document, descriptor, random) {
  const { parent, key } = locate(document, descriptor.path);
  const before = structuredClone(parent[key]);
  switch (descriptor.operator) {
    case 'boundary-number': {
      if (typeof before !== 'number') throw new Error('boundary-number requires a numeric target');
      const values = descriptor.values || [-1, 0, 1, Number.MAX_SAFE_INTEGER];
      parent[key] = choose(values.filter((value) => value !== before), random);
      break;
    }
    case 'flip-boolean':
      if (typeof before !== 'boolean') throw new Error('flip-boolean requires a boolean target');
      parent[key] = !before;
      break;
    case 'nullify':
      parent[key] = null;
      break;
    case 'delete-field':
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      break;
    case 'duplicate-array-element': {
      if (!Array.isArray(parent[key]) || parent[key].length === 0) {
        throw new Error('duplicate-array-element requires a non-empty array');
      }
      const index = Math.floor(random() * parent[key].length);
      parent[key].splice(index, 0, structuredClone(parent[key][index]));
      break;
    }
    case 'string-edge':
      if (typeof before !== 'string') throw new Error('string-edge requires a string target');
      parent[key] = choose(STRING_EDGES.filter((value) => value !== before), random);
      break;
    default:
      throw new Error('Unsupported mutation operator: ' + descriptor.operator);
  }
  return { before_digest: digestJson(before), after_digest: digestJson(parent[key] === undefined ? null : parent[key]) };
}

export function mutateAttack(parentAttack, descriptors, options = {}) {
  if (parentAttack.blind_status === 'active') throw new Error('Active blind attacks cannot be mutated');
  if (!Array.isArray(descriptors) || descriptors.length === 0) throw new Error('Mutation descriptors are required');
  const count = options.count || descriptors.length;
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Mutation count is out of range');
  const seed = String(options.seed || 'fae-red-team-v0.0.1');
  const random = createRng(seed);
  const children = [];
  const parentGeneration = parentAttack.lineage ? parentAttack.lineage.generation : 0;
  for (let index = 0; index < count; index += 1) {
    const descriptor = descriptors[index % descriptors.length];
    const child = structuredClone(parentAttack);
    delete child.attack_digest;
    const change = applyOperator(child, descriptor, random);
    const childKey = digestJson({
      parent_id: parentAttack.id,
      seed,
      index,
      descriptor,
      payload: child.payload
    }).slice(0, 16);
    child.id = parentAttack.id + '~' + childKey;
    child.title = parentAttack.title + ' [mutation ' + (index + 1) + ']';
    child.lineage = {
      parent_id: parentAttack.id,
      generation: parentGeneration + 1,
      mutation: {
        operator: descriptor.operator,
        path: descriptor.path,
        seed,
        index,
        ...change
      }
    };
    child.attack_digest = digestJson(Object.fromEntries(Object.entries(child).filter(([key]) => key !== 'attack_digest')));
    children.push(child);
  }
  const roots = [structuredClone(parentAttack), ...children];
  if (!roots[0].lineage) roots[0].lineage = { parent_id: null, generation: 0 };
  validateGenealogy(roots);
  return children;
}

export function proposeCrossDomainTransfers(attack, transferMap) {
  const proposals = [];
  for (const primitive of transferMap.primitives || []) {
    if (!primitive.source_domains.includes(attack.domain)) continue;
    for (const targetDomain of primitive.target_domains) {
      if (targetDomain === attack.domain) continue;
      const proposal = {
        schema_version: 'fae.red-team.transfer-proposal.v0.0.1',
        status: 'review-required',
        source_attack_id: attack.id,
        source_attack_digest: attack.attack_digest || digestJson(attack),
        primitive_id: primitive.id,
        target_domain: targetDomain,
        operators: primitive.operators,
        automatic_execution: false
      };
      proposal.proposal_digest = digestJson(proposal);
      proposals.push(proposal);
    }
  }
  return proposals;
}
