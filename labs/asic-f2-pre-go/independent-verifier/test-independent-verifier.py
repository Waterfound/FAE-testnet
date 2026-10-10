#!/usr/bin/env python3
import re
import subprocess
import sys
import time

exe = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fae-dp6-independent-verifier"

hdr = bytes.fromhex("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7")
task = bytes.fromhex("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10")
prev = bytes.fromhex("11" * 32)
height = (1001).to_bytes(8, "little")

expected = [
"855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c",
"b8a5277d9226b434cf67b7bd40abbf6567855eecd21d87b8141ccb89b082053a",
"ac00df85fe2338d511b9fcae75dc509af92e2fde1ce19d9951e4f05c35e0799a",
"93d6481107e50261ea64a8042f2f11207f2124ab0653b2e60bd2ef7fb1e19b4d",
"578553a7ae9e9be5f3feb28986e4189f58a60bab22ba3cc92c8bf14c05de187d",
"b617b446eb572bd6dd2917f5e3538e386a329f748d6236f6955814751b75533c",
"09a62accdff0fe82f9afec271d5ae680e2b5a46aa50be87fa3b3b7f5923ca5ad",
"5c2fe9d4817efe787707146b2e201eb662acb6221444f70c7a5d5cb2361c34c6",
"e363839a9e82a7dfdd8283e937daf4488118faf3ba68b5f84be362dd95b57a23",
"3fd54b69b09a1d9a490788efe36b9f6969563a9b8b3cd4e64dcd9a0f75e850eb",
"caede732f1fa26c0812ebcf61403f63a0b6a4041a2ee524dee86e4d45682759b",
"7daf75d27daeacdce11b39394723a6d53e6bc48b6eddb2e76783f955ef4e7118",
"061c9994ebec724f4c230f45376ec7fcfaaec1db857b2abb4907c25bb1ad1574",
"1ecb554e1beea1f23b3d488439b9290fd9ba0172683b33a769016ff077d3cc30",
"ccc925c3901834d4dcc2c154ea80a786e79ccce0b56215ef5d55ecc02255244b",
"6197d3b23a9f7a52abee994b6bfb820965e7645a815d0170824af43a0d75164b",
]

def make_input(nonce, h=hdr, t=task, p=prev, ht=height):
    return h + nonce.to_bytes(8, "little") + t + p + ht

def run_verify(inp, want):
    return subprocess.run([exe, inp.hex(), want], capture_output=True, text=True)

start = time.time()
passed = 0
for i, want in enumerate(expected):
    nonce = 1200 + i
    cp = run_verify(make_input(nonce), want)
    if cp.returncode != 0 or "verify=PASS" not in cp.stdout:
        print(cp.stdout)
        print(cp.stderr, file=sys.stderr)
        raise SystemExit(f"valid vector failed at nonce {nonce}")
    final = re.search(r"^final=([0-9a-f]{64})$", cp.stdout, re.M).group(1)
    if final != want:
        raise SystemExit(f"final mismatch at nonce {nonce}")
    print(f"valid nonce={nonce} PASS {final}")
    passed += 1

canonical = make_input(1200)
canon_want = expected[0]
negative = []

bad = bytearray(canonical); bad[0] ^= 1
negative.append(("header_bitflip_reuse", bytes(bad), canon_want))
bad = bytearray(canonical); bad[40] ^= 1
negative.append(("task_bitflip_reuse", bytes(bad), canon_want))
bad = bytearray(canonical); bad[72] ^= 1
negative.append(("prev_bitflip_reuse", bytes(bad), canon_want))
bad = bytearray(canonical); bad[104] ^= 1
negative.append(("height_bitflip_reuse", bytes(bad), canon_want))
negative.append(("nonce_reuse", make_input(1201), canon_want))
wrong = ("0" if canon_want[0] != "0" else "1") + canon_want[1:]
negative.append(("wrong_expected_proof", canonical, wrong))

neg_pass = 0
for name, inp, want in negative:
    cp = run_verify(inp, want)
    if cp.returncode == 0 or "verify=FAIL" not in cp.stdout:
        print(cp.stdout)
        print(cp.stderr, file=sys.stderr)
        raise SystemExit(f"negative proof unexpectedly accepted: {name}")
    print(f"negative {name} REJECT")
    neg_pass += 1

for bad_arg in ["ab" * 111, "x", "1" * 21]:
    cp = subprocess.run([exe, bad_arg, canon_want], capture_output=True, text=True)
    if cp.returncode == 0:
        raise SystemExit("malformed verifier input unexpectedly accepted")

cp = subprocess.run([exe, canonical.hex(), canon_want, "legacy-mode"], capture_output=True, text=True)
if cp.returncode == 0:
    raise SystemExit("unexpected path/mode selector argument accepted")

elapsed_ms = int((time.time() - start) * 1000)
print(f"FAE_DP6_INDEPENDENT_VALID_VECTORS={passed}/16")
print(f"FAE_DP6_INDEPENDENT_NEGATIVE_PROOFS={neg_pass}/6")
print("FAE_DP6_INDEPENDENT_INTERFACE_NEGATIVES=4/4")
print(f"elapsed_ms={elapsed_ms}")
