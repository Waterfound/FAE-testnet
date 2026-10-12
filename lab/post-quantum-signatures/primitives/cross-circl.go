package main

import (
  "bytes"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "os"
  "strings"

  "github.com/cloudflare/circl/sign/mldsa/mldsa44"
  "github.com/cloudflare/circl/sign/mldsa/mldsa65"
  "github.com/cloudflare/circl/sign/mldsa/mldsa87"
  "github.com/cloudflare/circl/sign/slhdsa"
)

type record struct {
  Algorithm string `json:"algorithm"`
  Family string `json:"family"`
  Message string `json:"message"`
  PublicKey string `json:"public_key"`
  Signature string `json:"signature"`
}
type document struct {
  Schema string `json:"schema"`
  Source string `json:"source"`
  Records []record `json:"records"`
}
func must(err error){ if err!=nil { panic(err) } }
func dec(s string)[]byte{ b,e:=hex.DecodeString(s); must(e); return b }
func enc(b []byte)string{ return hex.EncodeToString(b) }
func require(v bool,m string){ if !v { panic(m) } }
func tampered(sig []byte)[]byte{ b:=append([]byte(nil),sig...); if len(b)==0 { panic("empty signature") }; b[0]^=1; return b }

func verifyRecord(r record) bool {
  msg, pkb, sig := dec(r.Message), dec(r.PublicKey), dec(r.Signature)
  switch r.Algorithm {
  case "ML-DSA-44":
    var pk mldsa44.PublicKey; must(pk.UnmarshalBinary(pkb)); return mldsa44.Verify(&pk,msg,nil,sig)
  case "ML-DSA-65":
    var pk mldsa65.PublicKey; must(pk.UnmarshalBinary(pkb)); return mldsa65.Verify(&pk,msg,nil,sig)
  case "ML-DSA-87":
    var pk mldsa87.PublicKey; must(pk.UnmarshalBinary(pkb)); return mldsa87.Verify(&pk,msg,nil,sig)
  default:
    id,e:=slhdsa.IDByName(r.Algorithm); must(e)
    pk:=slhdsa.PublicKey{ID:id}; must(pk.UnmarshalBinary(pkb))
    return slhdsa.Verify(&pk,slhdsa.NewMessage(msg),sig,nil)
  }
}
func seed32(offset byte)[32]byte{ var s [32]byte; for i:=range s { s[i]=byte(int(offset)+i) }; return s }
func slhN(name string) int {
  if strings.Contains(name,"128") { return 16 }
  if strings.Contains(name,"192") { return 24 }
  if strings.Contains(name,"256") { return 32 }
  panic("unknown SLH security level")
}
func generateML(name string, offset byte) record {
  msg:=[]byte("FAE cross-implementation "+name)
  s:=seed32(offset)
  switch name {
  case "ML-DSA-44":
    pk,sk:=mldsa44.NewKeyFromSeed(&s); sig:=make([]byte,mldsa44.SignatureSize); must(mldsa44.SignTo(sk,msg,nil,false,sig))
    return record{name,"ML-DSA",enc(msg),enc(pk.Bytes()),enc(sig)}
  case "ML-DSA-65":
    pk,sk:=mldsa65.NewKeyFromSeed(&s); sig:=make([]byte,mldsa65.SignatureSize); must(mldsa65.SignTo(sk,msg,nil,false,sig))
    return record{name,"ML-DSA",enc(msg),enc(pk.Bytes()),enc(sig)}
  case "ML-DSA-87":
    pk,sk:=mldsa87.NewKeyFromSeed(&s); sig:=make([]byte,mldsa87.SignatureSize); must(mldsa87.SignTo(sk,msg,nil,false,sig))
    return record{name,"ML-DSA",enc(msg),enc(pk.Bytes()),enc(sig)}
  }
  panic("unknown ML algorithm")
}
func generateSLH(name string, offset byte) record {
  id,e:=slhdsa.IDByName(name); must(e)
  n:=slhN(name); seed:=make([]byte,3*n); for i:=range seed { seed[i]=byte(int(offset)+i) }
  pk,sk,e:=slhdsa.GenerateKey(bytes.NewReader(seed),id); must(e)
  msg:=[]byte("FAE cross-implementation "+name)
  sig,e:=slhdsa.SignDeterministic(&sk,slhdsa.NewMessage(msg),nil); must(e)
  pkb,e:=pk.MarshalBinary(); must(e)
  return record{name,"SLH-DSA",enc(msg),enc(pkb),enc(sig)}
}
func main(){
  if len(os.Args)!=3 { panic("usage: cross-circl input.json output.json") }
  raw,e:=os.ReadFile(os.Args[1]); must(e)
  var in document; must(json.Unmarshal(raw,&in))
  for _,r:=range in.Records {
    require(verifyRecord(r),"CIRCL rejected Noble record "+r.Algorithm)
    bad:=r; bad.Signature=enc(tampered(dec(r.Signature)))
    require(!verifyRecord(bad),"CIRCL accepted tampered Noble record "+r.Algorithm)
  }
  names:=[]string{
    "ML-DSA-44","ML-DSA-65","ML-DSA-87",
    "SLH-DSA-SHA2-128s","SLH-DSA-SHAKE-128f",
    "SLH-DSA-SHA2-192s","SLH-DSA-SHAKE-192f",
    "SLH-DSA-SHA2-256s","SLH-DSA-SHAKE-256f",
  }
  out:=document{Schema:"FAE_PQ_CROSS_CIRCL_TO_NOBLE_V1",Source:"cloudflare-circl@2ef8bf457d28ab1c62f42b76f6564610c5a3b3f0"}
  for i,name:=range names {
    if strings.HasPrefix(name,"ML-") { out.Records=append(out.Records,generateML(name,byte(71+i*7))) } else { out.Records=append(out.Records,generateSLH(name,byte(71+i*7))) }
  }
  encoded,e:=json.MarshalIndent(out,"","  "); must(e); encoded=append(encoded,'\n')
  must(os.WriteFile(os.Args[2],encoded,0644))
  fmt.Printf("{\"result\":\"PASS\",\"verified_noble\":%d,\"generated_circl\":%d}\n",len(in.Records),len(out.Records))
}
