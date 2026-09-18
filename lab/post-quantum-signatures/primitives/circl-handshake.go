package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"

	"github.com/cloudflare/circl/sign/mldsa/mldsa44"
	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

var message = []byte("FAE PQ Wave D cross-implementation handshake v1")

type evidenceCase struct {
	PublicKey string          `json:"publicKey"`
	Signature string          `json:"signature"`
	Negatives map[string]bool `json:"negatives"`
}

type evidence struct {
	Schema         string                  `json:"schema"`
	Implementation string                  `json:"implementation"`
	Commit         string                  `json:"commit"`
	Result         string                  `json:"result"`
	Cases          map[string]evidenceCase `json:"cases"`
}

func digest(label string) [32]byte {
	return sha256.Sum256([]byte(label))
}

func mutate(sig []byte) []byte {
	out := append([]byte(nil), sig...)
	out[len(out)/2] ^= 1
	return out
}

func negativeMatrix(verify func([]byte, bool) bool, sig []byte) map[string]bool {
	truncated := append([]byte(nil), sig[:len(sig)-1]...)
	extended := append(append([]byte(nil), sig...), 0)
	out := map[string]bool{
		"tampered_signature_rejected": !verify(mutate(sig), false),
		"wrong_public_key_rejected":    !verify(sig, true),
		"truncated_signature_rejected": !verify(truncated, false),
		"extended_signature_rejected":  !verify(extended, false),
	}
	for name, ok := range out {
		if !ok {
			panic("negative matrix failed: " + name)
		}
	}
	return out
}

func ml44Case() evidenceCase {
	seed := digest("FAE|ML-DSA-44|key")
	wrongSeed := digest("FAE|ML-DSA-44|wrong-key")
	pk, sk := mldsa44.NewKeyFromSeed(&seed)
	wrongPk, _ := mldsa44.NewKeyFromSeed(&wrongSeed)
	pkBytes, _ := pk.MarshalBinary()
	sig := make([]byte, mldsa44.SignatureSize)
	if err := mldsa44.SignTo(sk, message, nil, false, sig); err != nil { panic(err) }
	verify := func(candidate []byte, wrong bool) bool {
		use := pk
		if wrong { use = wrongPk }
		return mldsa44.Verify(use, message, nil, candidate)
	}
	if !verify(sig, false) { panic("ML-DSA-44 valid signature rejected") }
	return evidenceCase{hex.EncodeToString(pkBytes), hex.EncodeToString(sig), negativeMatrix(verify, sig)}
}

func ml65Case() evidenceCase {
	seed := digest("FAE|ML-DSA-65|key")
	wrongSeed := digest("FAE|ML-DSA-65|wrong-key")
	pk, sk := mldsa65.NewKeyFromSeed(&seed)
	wrongPk, _ := mldsa65.NewKeyFromSeed(&wrongSeed)
	pkBytes, _ := pk.MarshalBinary()
	sig := make([]byte, mldsa65.SignatureSize)
	if err := mldsa65.SignTo(sk, message, nil, false, sig); err != nil { panic(err) }
	verify := func(candidate []byte, wrong bool) bool {
		use := pk
		if wrong { use = wrongPk }
		return mldsa65.Verify(use, message, nil, candidate)
	}
	if !verify(sig, false) { panic("ML-DSA-65 valid signature rejected") }
	return evidenceCase{hex.EncodeToString(pkBytes), hex.EncodeToString(sig), negativeMatrix(verify, sig)}
}

func ml87Case() evidenceCase {
	seed := digest("FAE|ML-DSA-87|key")
	wrongSeed := digest("FAE|ML-DSA-87|wrong-key")
	pk, sk := mldsa87.NewKeyFromSeed(&seed)
	wrongPk, _ := mldsa87.NewKeyFromSeed(&wrongSeed)
	pkBytes, _ := pk.MarshalBinary()
	sig := make([]byte, mldsa87.SignatureSize)
	if err := mldsa87.SignTo(sk, message, nil, false, sig); err != nil { panic(err) }
	verify := func(candidate []byte, wrong bool) bool {
		use := pk
		if wrong { use = wrongPk }
		return mldsa87.Verify(use, message, nil, candidate)
	}
	if !verify(sig, false) { panic("ML-DSA-87 valid signature rejected") }
	return evidenceCase{hex.EncodeToString(pkBytes), hex.EncodeToString(sig), negativeMatrix(verify, sig)}
}

func slhSeed(name string, n int, wrong bool) []byte {
	prefix := "FAE|" + name + "|"
	if wrong { prefix += "wrong|" }
	a := digest(prefix + "skSeed")
	b := digest(prefix + "skPrf")
	c := digest(prefix + "pkSeed")
	out := make([]byte, 0, 3*n)
	out = append(out, a[:n]...)
	out = append(out, b[:n]...)
	out = append(out, c[:n]...)
	return out
}

func slhCase(name string, id slhdsa.ID, n int) evidenceCase {
	pk, sk, err := slhdsa.GenerateKey(bytes.NewReader(slhSeed(name, n, false)), id)
	if err != nil { panic(err) }
	wrongPk, _, err := slhdsa.GenerateKey(bytes.NewReader(slhSeed(name, n, true)), id)
	if err != nil { panic(err) }
	pkBytes, err := pk.MarshalBinary()
	if err != nil { panic(err) }
	sig, err := slhdsa.SignDeterministic(&sk, slhdsa.NewMessage(message), nil)
	if err != nil { panic(err) }
	verify := func(candidate []byte, wrong bool) bool {
		use := &pk
		if wrong { use = &wrongPk }
		return slhdsa.Verify(use, slhdsa.NewMessage(message), candidate, nil)
	}
	if !verify(sig, false) { panic(name + " valid signature rejected") }
	return evidenceCase{hex.EncodeToString(pkBytes), hex.EncodeToString(sig), negativeMatrix(verify, sig)}
}

func main() {
	outPath := os.Getenv("PQ_EVIDENCE_PATH")
	if outPath == "" { panic("PQ_EVIDENCE_PATH is required") }
	out := evidence{
		Schema: "FAE_PQ_WAVE_D_CIRCL_HANDSHAKE_V1",
		Implementation: "cloudflare/circl",
		Commit: "2ef8bf457d28ab1c62f42b76f6564610c5a3b3f0",
		Result: "PASS",
		Cases: map[string]evidenceCase{
			"ML-DSA-44": ml44Case(),
			"ML-DSA-65": ml65Case(),
			"ML-DSA-87": ml87Case(),
			"SLH-DSA-SHA2-128s": slhCase("SLH-DSA-SHA2-128s", slhdsa.SHA2_128s, 16),
			"SLH-DSA-SHAKE-128f": slhCase("SLH-DSA-SHAKE-128f", slhdsa.SHAKE_128f, 16),
			"SLH-DSA-SHA2-192s": slhCase("SLH-DSA-SHA2-192s", slhdsa.SHA2_192s, 24),
			"SLH-DSA-SHAKE-192f": slhCase("SLH-DSA-SHAKE-192f", slhdsa.SHAKE_192f, 24),
			"SLH-DSA-SHA2-256s": slhCase("SLH-DSA-SHA2-256s", slhdsa.SHA2_256s, 32),
			"SLH-DSA-SHAKE-256f": slhCase("SLH-DSA-SHAKE-256f", slhdsa.SHAKE_256f, 32),
		},
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil { panic(err) }
	if err := os.WriteFile(outPath, append(encoded, '
'), 0o644); err != nil { panic(err) }
	fmt.Printf("{"schema":%q,"result":%q,"algorithms":%d}
", out.Schema, out.Result, len(out.Cases))
}
