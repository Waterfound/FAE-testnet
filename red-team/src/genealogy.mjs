import { digestJson } from './canonical.mjs';

export function validateGenealogy(attacks) {
  const byId = new Map();
  for (const attack of attacks) {
    if (byId.has(attack.id)) throw new Error('Duplicate genealogy node: ' + attack.id);
    byId.set(attack.id, attack);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Genealogy cycle detected at ' + id);
    if (visited.has(id)) return;
    visiting.add(id);
    const attack = byId.get(id);
    if (!attack) throw new Error('Missing genealogy node: ' + id);
    const parentId = attack.lineage && attack.lineage.parent_id;
    if (parentId !== null && parentId !== undefined) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  for (const attack of attacks) {
    const lineage = attack.lineage || { parent_id: null, generation: 0 };
    if (lineage.parent_id === null) {
      if (lineage.generation !== 0) throw new Error('Root attack must have generation zero: ' + attack.id);
      continue;
    }
    const parent = byId.get(lineage.parent_id);
    if (!parent) throw new Error('Missing genealogy parent for ' + attack.id);
    const parentGeneration = (parent.lineage && parent.lineage.generation) || 0;
    if (lineage.generation !== parentGeneration + 1) throw new Error('Invalid generation for ' + attack.id);
    if (!lineage.mutation || typeof lineage.mutation !== 'object') throw new Error('Child lacks mutation record: ' + attack.id);
  }
  return true;
}

export function genealogyDigest(attacks) {
  validateGenealogy(attacks);
  return digestJson(attacks.map((attack) => ({
    id: attack.id,
    parent_id: attack.lineage ? attack.lineage.parent_id : null,
    generation: attack.lineage ? attack.lineage.generation : 0,
    mutation: attack.lineage ? attack.lineage.mutation || null : null
  })).sort((left, right) => left.id.localeCompare(right.id)));
}
