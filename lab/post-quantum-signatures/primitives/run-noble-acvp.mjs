import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ml_dsa44, ml_dsa65, ml_dsa87
} from '@noble/post-quantum/ml-dsa.js';
import {
  slh_dsa_sha2_128s, slh_dsa_sha2_128f,
  slh_dsa_sha2_192s, slh_dsa_sha2_192f,
  slh_dsa_sha2_256s, slh_dsa_sha2_256f,
  slh_dsa_shake_128s, slh_dsa_shake_128f,
  slh_dsa_shake_192s, slh_dsa_shake_192f,
  slh_dsa_shake_256s, slh_dsa_shake_256f
} from '@noble/post-quantum/slh-dsa.js';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from '@noble/hashes/sha3.js';

const base = process.env.PQ_ACVP_DIR;
if (!base) throw new Error('PQ_ACVP_DIR is required');

const ML = { 'ML-DSA-44': ml_dsa44, 'ML-DSA-65': ml_dsa65, 'ML-DSA-87': ml_dsa87 };
const SLH = {
  'SLH-DSA-SHA2-128s': slh_dsa_sha2_128s, 'SLH-DSA-SHA2-128f': slh_dsa_sha2_128f,
  'SLH-DSA-SHA2-192s': slh_dsa_sha2_192s, 'SLH-DSA-SHA2-192f': slh_dsa_sha2_192f,
  'SLH-DSA-SHA2-256s': slh_dsa_sha2_256s, 'SLH-DSA-SHA2-256f': slh_dsa_sha2_256f,
  'SLH-DSA-SHAKE-128s': slh_dsa_shake_128s, 'SLH-DSA-SHAKE-128f': slh_dsa_shake_128f,
  'SLH-DSA-SHAKE-192s': slh_dsa_shake_192s, 'SLH-DSA-SHAKE-192f': slh_dsa_shake_192f,
  'SLH-DSA-SHAKE-256s': slh_dsa_shake_256s, 'SLH-DSA-SHAKE-256f': slh_dsa_shake_256f
};
const REPRESENTATIVE = new Set([
  'SLH-DSA-SHA2-128s','SLH-DSA-SHAKE-128f',
  'SLH-DSA-SHA2-192s','SLH-DSA-SHAKE-192f',
  'SLH-DSA-SHA2-256s','SLH-DSA-SHAKE-256f'
]);
const HASHES = {
  'SHA2-224': sha224, 'SHA2-256': sha256, 'SHA2-384': sha384, 'SHA2-512': sha512,
  'SHA2-512/224': sha512_224, 'SHA2-512/256': sha512_256,
  'SHA3-224': sha3_224, 'SHA3-256': sha3_256, 'SHA3-384': sha3_384, 'SHA3-512': sha3_512,
  'SHAKE-128': Object.assign((m) => shake128(m, { dkLen: 32 }), { outputLen: 32 }),
  'SHAKE-256': Object.assign((m) => shake256(m, { dkLen: 64 }), { outputLen: 64 })
};

const hex = (s='') => Uint8Array.from(Buffer.from(s, 'hex'));
const eq = (a,b) => Buffer.from(a).equals(Buffer.from(b));
const assert = (v,m) => { if (!v) throw new Error(m); };
const safeVerify = (fn) => { try { return !!fn(); } catch { return false; } };
const strength = (hash) => (hash.outputLen * 8) / 2;
async function pair(name) {
  const dir = path.join(base, name);
  return {
    p: JSON.parse(await readFile(path.join(dir, 'prompt.json'), 'utf8')),
    e: JSON.parse(await readFile(path.join(dir, 'expectedResults.json'), 'utf8'))
  };
}
function expectedGroup(e, tgId) {
  const g = e.testGroups.find(x => x.tgId === tgId);
  if (!g) throw new Error('missing expected group ' + tgId);
  return new Map(g.tests.map(t => [t.tcId, t]));
}
function deterministicSeed(len, offset) {
  return Uint8Array.from({length:len}, (_,i)=>(i+offset)&255);
}

const evidence = {
  schema:'FAE_PQ_NOBLE_ACVP_REPLAY_V1',
  implementation:'@noble/post-quantum',
  version:'0.7.1',
  result:'PASS',
  pq03:{ keygen:0, siggen:0, sigver:0, policy_rejections:0, negative_cases:0 },
  pq04:{ keygen_sampled:0, sigver_positive:0, sigver_negative:0, siggen_representative:0, negative_cases:0, parameter_sets:[] }
};

// PQ-03: full frozen ACVP replay.
{
  const {p,e}=await pair('ML-DSA-keyGen-FIPS204');
  for (const g of p.testGroups) {
    const scheme=ML[g.parameterSet]; assert(scheme, 'unknown ML parameter set');
    const em=expectedGroup(e,g.tgId);
    for (const t of g.tests) {
      const want=em.get(t.tcId); assert(want, 'missing ML keygen result');
      const got=scheme.keygen(hex(t.seed));
      assert(eq(got.publicKey,hex(want.pk)), `ML keygen pk mismatch tc=${t.tcId}`);
      assert(eq(got.secretKey,hex(want.sk)), `ML keygen sk mismatch tc=${t.tcId}`);
      assert(eq(scheme.getPublicKey(got.secretKey),got.publicKey), 'ML getPublicKey mismatch');
      evidence.pq03.keygen++;
    }
  }
}
{
  const {p,e}=await pair('ML-DSA-sigGen-FIPS204');
  for (const g of p.testGroups) {
    const scheme=ML[g.parameterSet]; assert(scheme, 'unknown ML parameter set');
    const em=expectedGroup(e,g.tgId);
    for (const t of g.tests) {
      const want=em.get(t.tcId); assert(want, 'missing ML siggen result');
      const rnd=t.rnd ? hex(t.rnd) : false;
      const internalOpts={extraEntropy:rnd, externalMu:!!g.externalMu};
      let sig;
      if (g.signatureInterface==='internal') {
        sig=g.externalMu ? scheme.internal.sign(hex(t.mu),hex(t.sk),internalOpts) : scheme.internal.sign(hex(t.message),hex(t.sk),internalOpts);
      } else if (g.signatureInterface==='external') {
        const ctx=t.context ? hex(t.context) : undefined;
        const publicOpts={extraEntropy:rnd,context:ctx};
        if (g.preHash==='preHash') {
          const h=HASHES[t.hashAlg]; assert(h,'unknown hash '+t.hashAlg);
          if (strength(h)<scheme.securityLevel) {
            let threw=false; try { scheme.prehash(h); } catch { threw=true; }
            assert(threw,'weak ML prehash was not rejected');
            evidence.pq03.policy_rejections++; continue;
          }
          sig=scheme.prehash(h).sign(hex(t.message),hex(t.sk),publicOpts);
        } else sig=scheme.sign(hex(t.message),hex(t.sk),publicOpts);
      } else throw new Error('unknown ML signatureInterface');
      assert(eq(sig,hex(want.signature)), `ML siggen mismatch tc=${t.tcId}`);
      evidence.pq03.siggen++;
    }
  }
}
{
  const {p,e}=await pair('ML-DSA-sigVer-FIPS204');
  for (const g of p.testGroups) {
    const scheme=ML[g.parameterSet]; assert(scheme, 'unknown ML parameter set');
    const em=expectedGroup(e,g.tgId);
    for (const t of g.tests) {
      const want=em.get(t.tcId); assert(want, 'missing ML sigver result');
      let valid;
      if (g.signatureInterface==='internal') {
        valid=g.externalMu
          ? safeVerify(()=>scheme.internal.verify(hex(t.signature),hex(t.mu),hex(t.pk),{externalMu:true}))
          : safeVerify(()=>scheme.internal.verify(hex(t.signature),hex(t.message),hex(t.pk)));
      } else if (g.signatureInterface==='external') {
        const ctx=t.context ? hex(t.context) : undefined;
        if (g.preHash==='preHash') {
          const h=HASHES[t.hashAlg]; assert(h,'unknown hash '+t.hashAlg);
          if (strength(h)<scheme.securityLevel) {
            let threw=false; try { scheme.prehash(h); } catch { threw=true; }
            assert(threw,'weak ML verify prehash was not rejected');
            evidence.pq03.policy_rejections++; continue;
          }
          valid=safeVerify(()=>scheme.prehash(h).verify(hex(t.signature),hex(t.message),hex(t.pk),{context:ctx}));
        } else valid=safeVerify(()=>scheme.verify(hex(t.signature),hex(t.message),hex(t.pk),{context:ctx}));
      } else throw new Error('unknown ML signatureInterface');
      assert(valid===want.testPassed, `ML sigver mismatch tc=${t.tcId}`);
      evidence.pq03.sigver++;
    }
  }
}
for (const [name,scheme] of Object.entries(ML)) {
  const a=scheme.keygen(deterministicSeed(scheme.lengths.seed,11));
  const b=scheme.keygen(deterministicSeed(scheme.lengths.seed,99));
  const msg=new TextEncoder().encode('FAE PQ-03 negative matrix '+name);
  const sig=scheme.sign(msg,a.secretKey,{extraEntropy:false});
  assert(scheme.verify(sig,msg,a.publicKey), name+' baseline verify failed');
  const tampered=Uint8Array.from(sig); tampered[0]^=1;
  assert(!safeVerify(()=>scheme.verify(tampered,msg,a.publicKey)),name+' accepted tamper');
  assert(!safeVerify(()=>scheme.verify(sig,msg,b.publicKey)),name+' accepted wrong key');
  assert(!safeVerify(()=>scheme.verify(sig.slice(0,-1),msg,a.publicKey)),name+' accepted truncation');
  const extended=new Uint8Array(sig.length+1); extended.set(sig);
  assert(!safeVerify(()=>scheme.verify(extended,msg,a.publicKey)),name+' accepted extension');
  evidence.pq03.negative_cases+=4;
}

// PQ-04: predeclared bounded sampling over all 12 parameter sets.
{
  const {p,e}=await pair('SLH-DSA-keyGen-FIPS205');
  const seen=new Set();
  for (const g of p.testGroups) {
    if (seen.has(g.parameterSet)) continue;
    const scheme=SLH[g.parameterSet]; assert(scheme,'unknown SLH parameter set '+g.parameterSet);
    const t=[...g.tests].sort((a,b)=>a.tcId-b.tcId)[0];
    const want=expectedGroup(e,g.tgId).get(t.tcId);
    const seed=new Uint8Array([...hex(t.skSeed),...hex(t.skPrf),...hex(t.pkSeed)]);
    const got=scheme.keygen(seed);
    assert(eq(got.publicKey,hex(want.pk)),`SLH keygen pk mismatch ${g.parameterSet}`);
    assert(eq(got.secretKey,hex(want.sk)),`SLH keygen sk mismatch ${g.parameterSet}`);
    seen.add(g.parameterSet); evidence.pq04.keygen_sampled++;
  }
  assert(seen.size===12,'SLH keygen did not cover all 12 sets');
  evidence.pq04.parameter_sets=[...seen].sort();
}
{
  const {p,e}=await pair('SLH-DSA-sigVer-FIPS205');
  const covered=new Set();
  for (const name of Object.keys(SLH)) {
    const g=p.testGroups.find(x=>x.parameterSet===name && x.signatureInterface==='external' && x.preHash==='pure');
    assert(g,`no external/pure SLH sigVer group for ${name}`);
    const em=expectedGroup(e,g.tgId);
    const candidates=[...g.tests].sort((a,b)=>a.tcId-b.tcId).map(t=>({t,w:em.get(t.tcId)}));
    const pos=candidates.find(x=>x.w?.testPassed===true);
    const neg=candidates.find(x=>x.w?.testPassed===false);
    assert(pos&&neg,`need positive+negative SLH sigVer cases for ${name}`);
    for (const [kind,c] of [['positive',pos],['negative',neg]]) {
      const ctx=c.t.context ? hex(c.t.context) : undefined;
      const valid=safeVerify(()=>SLH[name].verify(hex(c.t.signature),hex(c.t.message),hex(c.t.pk),{context:ctx}));
      assert(valid===c.w.testPassed,`SLH sigVer ${kind} mismatch ${name}`);
      evidence.pq04[kind==='positive'?'sigver_positive':'sigver_negative']++;
    }
    covered.add(name);
  }
  assert(covered.size===12,'SLH sigVer did not cover all 12 sets');
}
{
  const {p,e}=await pair('SLH-DSA-sigGen-FIPS205');
  for (const name of REPRESENTATIVE) {
    const g=p.testGroups.find(x=>x.parameterSet===name && x.signatureInterface==='external' && x.preHash==='pure' && x.deterministic===true);
    assert(g,`no deterministic external/pure SLH sigGen group for ${name}`);
    const t=[...g.tests].sort((a,b)=>a.tcId-b.tcId)[0];
    const want=expectedGroup(e,g.tgId).get(t.tcId);
    const ctx=t.context ? hex(t.context) : undefined;
    const sig=SLH[name].sign(hex(t.message),hex(t.sk),{context:ctx,extraEntropy:false});
    assert(eq(sig,hex(want.signature)),`SLH sigGen mismatch ${name} tc=${t.tcId}`);
    evidence.pq04.siggen_representative++;
  }
}
for (const name of REPRESENTATIVE) {
  const scheme=SLH[name];
  const a=scheme.keygen(deterministicSeed(scheme.lengths.seed,17));
  const b=scheme.keygen(deterministicSeed(scheme.lengths.seed,113));
  const msg=new TextEncoder().encode('FAE PQ-04 negative matrix '+name);
  const sig=scheme.sign(msg,a.secretKey,{extraEntropy:false});
  assert(scheme.verify(sig,msg,a.publicKey),name+' baseline verify failed');
  const tampered=Uint8Array.from(sig); tampered[0]^=1;
  assert(!safeVerify(()=>scheme.verify(tampered,msg,a.publicKey)),name+' accepted tamper');
  assert(!safeVerify(()=>scheme.verify(sig,msg,b.publicKey)),name+' accepted wrong key');
  assert(!safeVerify(()=>scheme.verify(sig.slice(0,-1),msg,a.publicKey)),name+' accepted truncation');
  const extended=new Uint8Array(sig.length+1); extended.set(sig);
  assert(!safeVerify(()=>scheme.verify(extended,msg,a.publicKey)),name+' accepted extension');
  evidence.pq04.negative_cases+=4;
}

console.log(JSON.stringify(evidence,null,2));
