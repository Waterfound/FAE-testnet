package main

import (
  "encoding/json"
  "fmt"
  "os"

  "github.com/cloudflare/circl/sign/mldsa/mldsa44"
  "github.com/cloudflare/circl/sign/mldsa/mldsa65"
  "github.com/cloudflare/circl/sign/mldsa/mldsa87"
  "github.com/cloudflare/circl/sign/slhdsa"
)

type row struct {
  Name string `json:"name"`
  SignatureBytes int `json:"signature_bytes"`
  Valid bool `json:"valid"`
  RejectsTamper bool `json:"rejects_tamper"`
}

func main() {
  msg := []byte("FAE PQ-02 implementation-independence probe")
  rows := []row{}

  pk44, sk44, err := mldsa44.GenerateKey(nil); must(err)
  sig44 := make([]byte, mldsa44.SignatureSize); must(mldsa44.SignTo(sk44, msg, nil, false, sig44))
  rows = append(rows, checkML44(pk44, msg, sig44))

  pk65, sk65, err := mldsa65.GenerateKey(nil); must(err)
  sig65 := make([]byte, mldsa65.SignatureSize); must(mldsa65.SignTo(sk65, msg, nil, false, sig65))
  valid65 := mldsa65.Verify(pk65, msg, nil, sig65); bad65 := append([]byte(nil), sig65...); bad65[0] ^= 1
  reject65 := !mldsa65.Verify(pk65, msg, nil, bad65); require(valid65 && reject65, "ML-DSA-65")
  rows = append(rows, row{"ML-DSA-65", len(sig65), valid65, reject65})

  pk87, sk87, err := mldsa87.GenerateKey(nil); must(err)
  sig87 := make([]byte, mldsa87.SignatureSize); must(mldsa87.SignTo(sk87, msg, nil, false, sig87))
  valid87 := mldsa87.Verify(pk87, msg, nil, sig87); bad87 := append([]byte(nil), sig87...); bad87[0] ^= 1
  reject87 := !mldsa87.Verify(pk87, msg, nil, bad87); require(valid87 && reject87, "ML-DSA-87")
  rows = append(rows, row{"ML-DSA-87", len(sig87), valid87, reject87})

  spk, ssk, err := slhdsa.GenerateKey(nil, slhdsa.SHA2_128s); must(err)
  smsg := slhdsa.NewMessage(msg)
  ssig, err := slhdsa.SignDeterministic(&ssk, smsg, nil); must(err)
  svalid := slhdsa.Verify(&spk, smsg, ssig, nil); sbad := append([]byte(nil), ssig...); sbad[0] ^= 1
  sreject := !slhdsa.Verify(&spk, smsg, sbad, nil); require(svalid && sreject, "SLH-DSA-SHA2-128s")
  rows = append(rows, row{"SLH-DSA-SHA2-128s", len(ssig), svalid, sreject})

  out := map[string]any{
    "schema":"FAE_PQ02_CIRCL_PROBE_V1",
    "implementation":"cloudflare/circl",
    "commit":"2ef8bf457d28ab1c62f42b76f6564610c5a3b3f0",
    "result":"PASS",
    "rows":rows,
  }
  enc := json.NewEncoder(os.Stdout); enc.SetIndent("", "  "); must(enc.Encode(out))
}

func checkML44(pk *mldsa44.PublicKey, msg, sig []byte) row {
  valid := mldsa44.Verify(pk, msg, nil, sig)
  bad := append([]byte(nil), sig...); bad[0] ^= 1
  reject := !mldsa44.Verify(pk, msg, nil, bad)
  require(valid && reject, "ML-DSA-44")
  return row{"ML-DSA-44", len(sig), valid, reject}
}
func must(err error) { if err != nil { panic(err) } }
func require(ok bool, name string) { if !ok { panic(fmt.Sprintf("%s probe failed", name)) } }
