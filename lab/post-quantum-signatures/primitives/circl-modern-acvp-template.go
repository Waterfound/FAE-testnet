package internal

import (
  "bytes"
  "crypto/sha256"
  "crypto/sha512"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "io"
  "os"
  "path/filepath"
  "testing"

  circlsha3 "github.com/cloudflare/circl/internal/sha3"
  common "github.com/cloudflare/circl/sign/internal/dilithium"
  xsha3 "golang.org/x/crypto/sha3"
)

const faeParameterSet = "__PARAMETER_SET__"

type faeACVPFile struct {
  TestGroups []json.RawMessage `json:"testGroups"`
}
type faeGroup struct {
  TgID int `json:"tgId"`
  ParameterSet string `json:"parameterSet"`
  SignatureInterface string `json:"signatureInterface"`
  ExternalMu bool `json:"externalMu"`
  PreHash string `json:"preHash"`
  Deterministic bool `json:"deterministic"`
  Tests []faeCase `json:"tests"`
}
type faeCase struct {
  TcID int `json:"tcId"`
  Seed string `json:"seed"`
  Sk string `json:"sk"`
  Pk string `json:"pk"`
  Message string `json:"message"`
  Mu string `json:"mu"`
  Rnd string `json:"rnd"`
  Context string `json:"context"`
  HashAlg string `json:"hashAlg"`
  Signature string `json:"signature"`
  TestPassed bool `json:"testPassed"`
}
type faeExpected struct {
  byID map[int]faeCase
}
func faeHex(s string) []byte {
  b, err := hex.DecodeString(s)
  if err != nil { panic(err) }
  return b
}
func faeRead(name string) faeACVPFile {
  root := os.Getenv("PQ_ACVP_DIR")
  if root == "" { panic("PQ_ACVP_DIR is required") }
  raw, err := os.ReadFile(filepath.Join(root, name))
  if err != nil { panic(err) }
  var f faeACVPFile
  if err := json.Unmarshal(raw, &f); err != nil { panic(err) }
  return f
}
func faeResults(name string) faeExpected {
  f := faeRead(name)
  out := faeExpected{byID: map[int]faeCase{}}
  for _, raw := range f.TestGroups {
    var g faeGroup
    if err := json.Unmarshal(raw, &g); err != nil { panic(err) }
    for _, tc := range g.Tests { out.byID[tc.TcID] = tc }
  }
  return out
}
func faeWriter(b []byte) func(io.Writer) {
  return func(w io.Writer) { _, _ = w.Write(b) }
}
func faeRnd(s string) [32]byte {
  var out [32]byte
  b := faeHex(s)
  if len(b) != 0 && len(b) != 32 { panic(fmt.Sprintf("rnd must be 32 bytes, got %d", len(b))) }
  copy(out[:], b)
  return out
}
func faeOID(last byte) []byte {
  return []byte{0x06,0x09,0x60,0x86,0x48,0x01,0x65,0x03,0x04,0x02,last}
}
func faePrehash(name string, msg []byte) ([]byte, []byte) {
  switch name {
  case "SHA2-224":
    x := sha256.Sum224(msg); return faeOID(0x04), x[:]
  case "SHA2-256":
    x := sha256.Sum256(msg); return faeOID(0x01), x[:]
  case "SHA2-384":
    x := sha512.Sum384(msg); return faeOID(0x02), x[:]
  case "SHA2-512":
    x := sha512.Sum512(msg); return faeOID(0x03), x[:]
  case "SHA2-512/224":
    x := sha512.Sum512_224(msg); return faeOID(0x05), x[:]
  case "SHA2-512/256":
    x := sha512.Sum512_256(msg); return faeOID(0x06), x[:]
  case "SHA3-224":
    h := xsha3.New224(); _,_ = h.Write(msg); return faeOID(0x07), h.Sum(nil)
  case "SHA3-256":
    h := xsha3.New256(); _,_ = h.Write(msg); return faeOID(0x08), h.Sum(nil)
  case "SHA3-384":
    h := xsha3.New384(); _,_ = h.Write(msg); return faeOID(0x09), h.Sum(nil)
  case "SHA3-512":
    h := xsha3.New512(); _,_ = h.Write(msg); return faeOID(0x0a), h.Sum(nil)
  case "SHAKE-128":
    h := xsha3.NewShake128(); _,_ = h.Write(msg); out := make([]byte,32); _,_ = h.Read(out); return faeOID(0x0b), out
  case "SHAKE-256":
    h := xsha3.NewShake256(); _,_ = h.Write(msg); out := make([]byte,64); _,_ = h.Read(out); return faeOID(0x0c), out
  default:
    panic("unknown prehash: " + name)
  }
}
func faeExternalMessage(tc faeCase, g faeGroup) func(io.Writer) {
  msg, ctx := faeHex(tc.Message), faeHex(tc.Context)
  if g.PreHash != "preHash" { return MPrime(msg, ctx) }
  oid, digest := faePrehash(tc.HashAlg, msg)
  m := make([]byte,0,2+len(ctx)+len(oid)+len(digest))
  m = append(m, 1, byte(len(ctx)))
  m = append(m, ctx...)
  m = append(m, oid...)
  m = append(m, digest...)
  return faeWriter(m)
}
func faeUnpackSK(b []byte) *PrivateKey {
  if len(b) != PrivateKeySize { panic(fmt.Sprintf("wrong private key size %d",len(b))) }
  var arr [PrivateKeySize]byte
  copy(arr[:],b)
  var sk PrivateKey
  sk.Unpack(&arr)
  return &sk
}
func faeUnpackPK(b []byte) *PublicKey {
  if len(b) != PublicKeySize { panic(fmt.Sprintf("wrong public key size %d",len(b))) }
  var arr [PublicKeySize]byte
  copy(arr[:],b)
  var pk PublicKey
  pk.Unpack(&arr)
  return &pk
}

// faeVerifyMu is test-only. It is the pinned CIRCL Verify core with the
// computeMu(tr,msg) step replaced by an already-computed FIPS 204 μ.
func faeVerifyMu(pk *PublicKey, mu *[64]byte, signature []byte) bool {
  var sig unpackedSignature
  var zh VecL
  var Az, Az2dct1, w1 VecK
  var ch common.Poly
  var cp [CTildeSize]byte
  var w1Packed [PolyW1Size * K]byte
  if !sig.Unpack(signature) { return false }
  zh = sig.z
  zh.NTT()
  for i := 0; i < K; i++ { PolyDotHat(&Az[i], &pk.A[i], &zh) }
  Az2dct1.MulBy2toD(&pk.t1)
  Az2dct1.NTT()
  PolyDeriveUniformBall(&ch, sig.c[:])
  ch.NTT()
  for i := 0; i < K; i++ { Az2dct1[i].MulHat(&Az2dct1[i], &ch) }
  Az2dct1.Sub(&Az, &Az2dct1)
  Az2dct1.ReduceLe2Q()
  Az2dct1.InvNTT()
  Az2dct1.NormalizeAssumingLe2Q()
  w1.UseHint(&Az2dct1, &sig.hint)
  w1.PackW1(w1Packed[:])
  h := circlsha3.NewShake256()
  _, _ = h.Write(mu[:])
  _, _ = h.Write(w1Packed[:])
  _, _ = h.Read(cp[:])
  return sig.c == cp
}

func TestFAEModernACVP(t *testing.T) {
  t.Run("keyGen", faeTestKeygen)
  t.Run("sigGen", faeTestSiggen)
  t.Run("sigVer", faeTestSigver)
}
func faeTestKeygen(t *testing.T) {
  p := faeRead("ML-DSA-keyGen-FIPS204/prompt.json")
  e := faeResults("ML-DSA-keyGen-FIPS204/expectedResults.json")
  count:=0
  for _, raw := range p.TestGroups {
    var g faeGroup
    if err:=json.Unmarshal(raw,&g); err!=nil { t.Fatal(err) }
    if g.ParameterSet != faeParameterSet { continue }
    for _,tc := range g.Tests {
      want,ok:=e.byID[tc.TcID]; if !ok { t.Fatalf("missing result tc=%d",tc.TcID) }
      seedb:=faeHex(tc.Seed); if len(seedb)!=32 { t.Fatalf("seed tc=%d",tc.TcID) }
      var seed [32]byte; copy(seed[:],seedb)
      pk,sk:=NewKeyFromSeed(&seed)
      var pkb [PublicKeySize]byte; pk.Pack(&pkb)
      var skb [PrivateKeySize]byte; sk.Pack(&skb)
      if !bytes.Equal(pkb[:],faeHex(want.Pk)) { t.Fatalf("keygen pk mismatch tc=%d",tc.TcID) }
      if !bytes.Equal(skb[:],faeHex(want.Sk)) { t.Fatalf("keygen sk mismatch tc=%d",tc.TcID) }
      count++
    }
  }
  if count==0 { t.Fatal("no keygen cases") }
  t.Logf("FAE modern ACVP keyGen PASS parameter=%s cases=%d",faeParameterSet,count)
}
func faeTestSiggen(t *testing.T) {
  p:=faeRead("ML-DSA-sigGen-FIPS204/prompt.json")
  e:=faeResults("ML-DSA-sigGen-FIPS204/expectedResults.json")
  count:=0
  for _,raw:=range p.TestGroups {
    var g faeGroup
    if err:=json.Unmarshal(raw,&g); err!=nil { t.Fatal(err) }
    if g.ParameterSet!=faeParameterSet { continue }
    for _,tc:=range g.Tests {
      want,ok:=e.byID[tc.TcID]; if !ok { t.Fatalf("missing result tc=%d",tc.TcID) }
      sk:=faeUnpackSK(faeHex(tc.Sk))
      rnd:=faeRnd(tc.Rnd)
      got:=make([]byte,SignatureSize)
      if g.SignatureInterface=="internal" && g.ExternalMu {
        mub:=faeHex(tc.Mu); if len(mub)!=64 { t.Fatalf("mu size tc=%d",tc.TcID) }
        var mu [64]byte; copy(mu[:],mub)
        SignMuTo(sk,&mu,rnd,got)
      } else {
        var m func(io.Writer)
        if g.SignatureInterface=="internal" { m=faeWriter(faeHex(tc.Message)) } else { m=faeExternalMessage(tc,g) }
        SignTo(sk,m,rnd,got)
      }
      if !bytes.Equal(got,faeHex(want.Signature)) { t.Fatalf("siggen mismatch tc=%d iface=%s prehash=%s externalMu=%v",tc.TcID,g.SignatureInterface,g.PreHash,g.ExternalMu) }
      count++
    }
  }
  if count==0 { t.Fatal("no siggen cases") }
  t.Logf("FAE modern ACVP sigGen PASS parameter=%s cases=%d",faeParameterSet,count)
}
func faeTestSigver(t *testing.T) {
  p:=faeRead("ML-DSA-sigVer-FIPS204/prompt.json")
  e:=faeResults("ML-DSA-sigVer-FIPS204/expectedResults.json")
  count:=0
  for _,raw:=range p.TestGroups {
    var g faeGroup
    if err:=json.Unmarshal(raw,&g); err!=nil { t.Fatal(err) }
    if g.ParameterSet!=faeParameterSet { continue }
    for _,tc:=range g.Tests {
      want,ok:=e.byID[tc.TcID]; if !ok { t.Fatalf("missing result tc=%d",tc.TcID) }
      pk:=faeUnpackPK(faeHex(tc.Pk))
      sig:=faeHex(tc.Signature)
      var got bool
      if g.SignatureInterface=="internal" && g.ExternalMu {
        mub:=faeHex(tc.Mu); if len(mub)!=64 { t.Fatalf("mu size tc=%d",tc.TcID) }
        var mu [64]byte; copy(mu[:],mub)
        got=faeVerifyMu(pk,&mu,sig)
      } else {
        var m func(io.Writer)
        if g.SignatureInterface=="internal" { m=faeWriter(faeHex(tc.Message)) } else { m=faeExternalMessage(tc,g) }
        got=Verify(pk,m,sig)
      }
      if got!=want.TestPassed { t.Fatalf("sigver mismatch tc=%d got=%v want=%v iface=%s prehash=%s externalMu=%v",tc.TcID,got,want.TestPassed,g.SignatureInterface,g.PreHash,g.ExternalMu) }
      count++
    }
  }
  if count==0 { t.Fatal("no sigver cases") }
  t.Logf("FAE modern ACVP sigVer PASS parameter=%s cases=%d",faeParameterSet,count)
}
