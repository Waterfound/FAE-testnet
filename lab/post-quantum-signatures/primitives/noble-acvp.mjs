import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';

import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import {
  slh_dsa_sha2_128f,
  slh_dsa_sha2_128s,
  slh_dsa_sha2_192f,
  slh_dsa_sha2_192s,
  slh_dsa_sha2_256f,
  slh_dsa_sha2_256s,
  slh_dsa_shake_128f,
  slh_dsa_shake_128s,
  slh_dsa_shake_192f,
  slh_dsa_shake_192s,
  slh_dsa_shake_256f,
  slh_dsa_shake_256s
} from '@noble/post-quantum/slh-dsa.js';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { sha3_224, sha3_256, sha3_384, sha3_512, shake128_32, shake256_64 } from '@noble/hashes/sha3.js';

const root = process.cwd();
const mode = process.argv[2];
const acvpDir = process.env.PQ_ACVP_DIR;
const evidencePath = process.env.PQ_EVIDENCE_PATH;
if (!mode || !acvpDir || !evidencePath) {
  throw new Error('usage: noble-acvp.mjs <mldsa-full|slhdsa-diversity> with PQ_ACVP_DIR and PQ_EVIDENCE_PATH');
}

const hex = value => new Uint8Array(Buffer.from(value || '', 'hex'));
const concat = (...arrs) => {
  const length = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(length);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
};
const eqBytes = (actual, expected, label) => {
  deepStrictEqual(Buffer.from(actual), Buffer.from(expected), label);
};
const HASHES = {
  'SHA2-256': sha256,
  'SHA2-384': sha384,
  'SHA2-512': sha512,
  'SHA2-224': sha224,
  'SHA2-512/224': sha512_224,
  'SHA2-512/256': sha512_256,
  'SHA3-224': sha3_224,
  'SHA3-256': sha3_256,
  'SHA3-384': sha3_384,
  'SHA3-512': sha3_512,
  'SHAKE-128': shake128_32,
  'SHAKE-256': shake256_64
};
const strength = hash => (hash.outputLen * 8) / 2;

async function loadSuite(name) {
  const prompt = JSON.parse(await readFile(path.join(acvpDir, name, 'prompt.json'), 'utf8'));
  const results = JSON.parse(await readFile(path.join(acvpDir, name, 'expectedResults.json'), 'utf8'));
  return { prompt, results };
}
function groupMap(results) {
  return new Map(results.testGroups.map(g => [g.tgId, g]));
}
function testMap(group) {
  if (!group) throw new Error('missing expectedResults group');
  return new Map(group.tests.map(t => [t.tcId, t]));
}
function sortedTests(group) {
  return [...group.tests].sort((a, b) => a.tcId - b.tcId);
}
function pureContext(test) {
  return test.context ? hex(test.context) : undefined;
}

async function runMLDSA() {
  const NAMES = { 'ML-DSA-44': ml_dsa44, 'ML-DSA-65': ml_dsa65, 'ML-DSA-87': ml_dsa87 };
  const summary = {
    schema: 'FAE_PQ03_NOBLE_ACVP_V1',
    implementation: '@noble/post-quantum',
    version: '0.7.1',
    scope: 'FULL_FROZEN_ACVP_REPLAY',
    result: 'PASS',
    counts: { keyGen: 0, sigGen: 0, sigVer: 0, policyRejections: 0 },
    parameterSets: Object.keys(NAMES)
  };

  {
    const { prompt, results } = await loadSuite('ML-DSA-keyGen-FIPS204');
    const rg = groupMap(results);
    for (const g of prompt.testGroups) {
      const scheme = NAMES[g.parameterSet];
      if (!scheme) throw new Error('unknown ML-DSA parameter set ' + g.parameterSet);
      const rm = testMap(rg.get(g.tgId));
      for (const t of g.tests) {
        const want = rm.get(t.tcId);
        const { publicKey, secretKey } = scheme.keygen(hex(t.seed));
        eqBytes(publicKey, hex(want.pk), 'ML-DSA keyGen pk tcId=' + t.tcId);
        eqBytes(secretKey, hex(want.sk), 'ML-DSA keyGen sk tcId=' + t.tcId);
        eqBytes(scheme.getPublicKey(secretKey), publicKey, 'ML-DSA getPublicKey tcId=' + t.tcId);
        summary.counts.keyGen++;
      }
    }
  }

  {
    const { prompt, results } = await loadSuite('ML-DSA-sigGen-FIPS204');
    const rg = groupMap(results);
    for (const g of prompt.testGroups) {
      const scheme = NAMES[g.parameterSet];
      if (!scheme) throw new Error('unknown ML-DSA parameter set ' + g.parameterSet);
      const rm = testMap(rg.get(g.tgId));
      for (const t of g.tests) {
        const want = rm.get(t.tcId);
        const rnd = t.rnd ? hex(t.rnd) : false;
        const baseOpts = { extraEntropy: rnd, externalMu: g.externalMu };
        let signature;
        if (g.signatureInterface === 'internal') {
          signature = scheme.internal.sign(
            g.externalMu ? hex(t.mu) : hex(t.message),
            hex(t.sk),
            baseOpts
          );
        } else if (g.signatureInterface === 'external') {
          const opts = { ...baseOpts, context: pureContext(t) };
          if (g.preHash === 'preHash') {
            const hash = HASHES[t.hashAlg];
            if (!hash) throw new Error('unknown hash ' + t.hashAlg);
            if (strength(hash) < scheme.securityLevel) {
              throws(() => scheme.prehash(hash));
              summary.counts.policyRejections++;
              continue;
            }
            signature = scheme.prehash(hash).sign(hex(t.message), hex(t.sk), opts);
          } else {
            signature = scheme.sign(hex(t.message), hex(t.sk), opts);
          }
        } else {
          throw new Error('unknown signatureInterface ' + g.signatureInterface);
        }
        eqBytes(signature, hex(want.signature), 'ML-DSA sigGen tcId=' + t.tcId);
        summary.counts.sigGen++;
      }
    }
  }

  {
    const { prompt, results } = await loadSuite('ML-DSA-sigVer-FIPS204');
    const rg = groupMap(results);
    for (const g of prompt.testGroups) {
      const scheme = NAMES[g.parameterSet];
      if (!scheme) throw new Error('unknown ML-DSA parameter set ' + g.parameterSet);
      const rm = testMap(rg.get(g.tgId));
      for (const t of g.tests) {
        const want = rm.get(t.tcId);
        let valid;
        try {
          if (g.signatureInterface === 'internal') {
            valid = scheme.internal.verify(
              hex(t.signature),
              g.externalMu ? hex(t.mu) : hex(t.message),
              hex(t.pk),
              g.externalMu ? { externalMu: true } : undefined
            );
          } else if (g.signatureInterface === 'external') {
            const opts = { context: pureContext(t) };
            if (g.preHash === 'preHash') {
              const hash = HASHES[t.hashAlg];
              if (!hash) throw new Error('unknown hash ' + t.hashAlg);
              if (strength(hash) < scheme.securityLevel) {
                throws(() => scheme.prehash(hash));
                summary.counts.policyRejections++;
                continue;
              }
              valid = scheme.prehash(hash).verify(hex(t.signature), hex(t.message), hex(t.pk), opts);
            } else {
              valid = scheme.verify(hex(t.signature), hex(t.message), hex(t.pk), opts);
            }
          } else {
            throw new Error('unknown signatureInterface ' + g.signatureInterface);
          }
        } catch {
          valid = false;
        }
        strictEqual(valid, want.testPassed, 'ML-DSA sigVer tcId=' + t.tcId);
        summary.counts.sigVer++;
      }
    }
  }

  return summary;
}

async function runSLHDSA() {
  const NAMES = {
    'SLH-DSA-SHA2-128s': slh_dsa_sha2_128s,
    'SLH-DSA-SHA2-128f': slh_dsa_sha2_128f,
    'SLH-DSA-SHA2-192s': slh_dsa_sha2_192s,
    'SLH-DSA-SHA2-192f': slh_dsa_sha2_192f,
    'SLH-DSA-SHA2-256s': slh_dsa_sha2_256s,
    'SLH-DSA-SHA2-256f': slh_dsa_sha2_256f,
    'SLH-DSA-SHAKE-128s': slh_dsa_shake_128s,
    'SLH-DSA-SHAKE-128f': slh_dsa_shake_128f,
    'SLH-DSA-SHAKE-192s': slh_dsa_shake_192s,
    'SLH-DSA-SHAKE-192f': slh_dsa_shake_192f,
    'SLH-DSA-SHAKE-256s': slh_dsa_shake_256s,
    'SLH-DSA-SHAKE-256f': slh_dsa_shake_256f
  };
  const manifest = JSON.parse(
    await readFile(path.join(root, 'lab/post-quantum-signatures/primitives/manifest.json'), 'utf8')
  );
  const representatives = new Set(manifest['PQ-04'].representative_signing_sets);
  const summary = {
    schema: 'FAE_PQ04_NOBLE_DIVERSITY_V1',
    implementation: '@noble/post-quantum',
    version: '0.7.1',
    result: 'PASS',
    selectionPolicy: manifest['PQ-04'].official_vector_policy,
    counts: { keyGen: 0, sigGen: 0, sigVer: 0 },
    selections: { keyGen: [], sigGen: [], sigVer: [] }
  };

  {
    const { prompt, results } = await loadSuite('SLH-DSA-keyGen-FIPS205');
    const rg = groupMap(results);
    for (const g of [...prompt.testGroups].sort((a, b) => a.tgId - b.tgId)) {
      const scheme = NAMES[g.parameterSet];
      if (!scheme) throw new Error('unknown SLH-DSA parameter set ' + g.parameterSet);
      const t = sortedTests(g)[0];
      const want = testMap(rg.get(g.tgId)).get(t.tcId);
      const { publicKey, secretKey } = scheme.keygen(
        concat(hex(t.skSeed), hex(t.skPrf), hex(t.pkSeed))
      );
      eqBytes(publicKey, hex(want.pk), 'SLH keyGen pk tcId=' + t.tcId);
      eqBytes(secretKey, hex(want.sk), 'SLH keyGen sk tcId=' + t.tcId);
      eqBytes(scheme.getPublicKey(secretKey), publicKey, 'SLH getPublicKey tcId=' + t.tcId);
      summary.counts.keyGen++;
      summary.selections.keyGen.push({ parameterSet: g.parameterSet, tgId: g.tgId, tcId: t.tcId });
    }
  }

  {
    const { prompt, results } = await loadSuite('SLH-DSA-sigGen-FIPS205');
    const rg = groupMap(results);
    for (const parameterSet of manifest['PQ-04'].representative_signing_sets) {
      const groups = [...prompt.testGroups]
        .filter(g =>
          g.parameterSet === parameterSet &&
          g.signatureInterface === 'external' &&
          g.preHash === 'pure' &&
          g.deterministic === true
        )
        .sort((a, b) => a.tgId - b.tgId);
      if (!groups.length) throw new Error('missing deterministic external/pure sigGen group for ' + parameterSet);
      const g = groups[0];
      const t = sortedTests(g)[0];
      const want = testMap(rg.get(g.tgId)).get(t.tcId);
      const scheme = NAMES[parameterSet];
      const opts = {
        context: pureContext(t),
        extraEntropy: t.additionalRandomness ? hex(t.additionalRandomness) : false
      };
      const signature = scheme.sign(hex(t.message), hex(t.sk), opts);
      eqBytes(signature, hex(want.signature), 'SLH sigGen ' + parameterSet + ' tcId=' + t.tcId);
      strictEqual(
        scheme.verify(signature, hex(t.message), scheme.getPublicKey(hex(t.sk)), { context: pureContext(t) }),
        true,
        'SLH generated signature verify ' + parameterSet
      );
      summary.counts.sigGen++;
      summary.selections.sigGen.push({ parameterSet, tgId: g.tgId, tcId: t.tcId });
    }
  }

  {
    const { prompt, results } = await loadSuite('SLH-DSA-sigVer-FIPS205');
    const rg = groupMap(results);
    for (const parameterSet of Object.keys(NAMES)) {
      const groups = [...prompt.testGroups]
        .filter(g =>
          g.parameterSet === parameterSet &&
          g.signatureInterface === 'external' &&
          g.preHash === 'pure'
        )
        .sort((a, b) => a.tgId - b.tgId);
      if (!groups.length) throw new Error('missing external/pure sigVer group for ' + parameterSet);
      const g = groups[0];
      const rm = testMap(rg.get(g.tgId));
      const paired = sortedTests(g).map(t => ({ prompt: t, result: rm.get(t.tcId) }));
      const positive = paired.find(x => x.result.testPassed === true);
      const negative = paired.find(x => x.result.testPassed === false);
      if (!positive || !negative) throw new Error('missing positive/negative sigVer pair for ' + parameterSet);
      for (const chosen of [positive, negative]) {
        const t = chosen.prompt;
        let valid;
        try {
          valid = NAMES[parameterSet].verify(
            hex(t.signature),
            hex(t.message),
            hex(t.pk),
            { context: pureContext(t) }
          );
        } catch {
          valid = false;
        }
        strictEqual(valid, chosen.result.testPassed, 'SLH sigVer ' + parameterSet + ' tcId=' + t.tcId);
        summary.counts.sigVer++;
        summary.selections.sigVer.push({
          parameterSet,
          tgId: g.tgId,
          tcId: t.tcId,
          expected: chosen.result.testPassed
        });
      }
    }
  }

  const expectedSets = new Set(Object.keys(NAMES));
  const coveredKeygen = new Set(summary.selections.keyGen.map(x => x.parameterSet));
  const coveredSigver = new Set(summary.selections.sigVer.map(x => x.parameterSet));
  for (const set of expectedSets) {
    if (!coveredKeygen.has(set)) throw new Error('SLH keyGen missing parameter set ' + set);
    if (!coveredSigver.has(set)) throw new Error('SLH sigVer missing parameter set ' + set);
  }
  for (const set of representatives) {
    if (!summary.selections.sigGen.some(x => x.parameterSet === set)) {
      throw new Error('SLH sigGen missing representative set ' + set);
    }
  }
  return summary;
}

let evidence;
if (mode === 'mldsa-full') evidence = await runMLDSA();
else if (mode === 'slhdsa-diversity') evidence = await runSLHDSA();
else throw new Error('unknown mode ' + mode);

await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
