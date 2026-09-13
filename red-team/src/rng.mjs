import { sha256Text } from './canonical.mjs';

const MASK_64 = (1n << 64n) - 1n;

export function seedToBigInt(seed) {
  const digest = sha256Text(String(seed));
  return BigInt('0x' + digest.slice(0, 16)) || 1n;
}

export function createRng(seed) {
  let state = seedToBigInt(seed);
  return function random() {
    state ^= state >> 12n;
    state ^= (state << 25n) & MASK_64;
    state ^= state >> 27n;
    state &= MASK_64;
    const mixed = (state * 2685821657736338717n) & MASK_64;
    return Number(mixed >> 11n) / 9007199254740992;
  };
}

export function seededShuffle(items, seed) {
  const output = [...items];
  const random = createRng(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [output[index], output[selected]] = [output[selected], output[index]];
  }
  return output;
}
