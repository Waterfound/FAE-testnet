#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <openssl/sha.h>
extern "C" {
#include "argon2.h"
#include "core.h"
#include "blake2/blake2.h"
}

static constexpr uint32_t PROGRAMS=8, PROGRAM_SIZE=256, STEPS=131072;
static constexpr uint64_t QWORDS=(256ull*1024ull*1024ull)/8ull;
struct Instr { uint8_t op,dst,src,src2; uint32_t imm; };

static inline uint32_t rd32(const uint8_t*p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
static inline uint64_t rd64(const uint8_t*p){return uint64_t(rd32(p))|(uint64_t(rd32(p+4))<<32);}
static inline void wr32(uint8_t*p,uint32_t x){for(int i=0;i<4;i++)p[i]=uint8_t(x>>(8*i));}
static inline void wr64(uint8_t*p,uint64_t x){for(int i=0;i<8;i++)p[i]=uint8_t(x>>(8*i));}
static inline uint64_t rol(uint64_t x,unsigned n){n&=63; return n?((x<<n)|(x>>(64-n))):x;}
static inline uint64_t ror(uint64_t x,unsigned n){n&=63; return n?((x>>n)|(x<<(64-n))):x;}
static inline uint64_t mulhi(uint64_t a,uint64_t b){return uint64_t(((__uint128_t)a*b)>>64);}
static inline unsigned pop(uint64_t x){return __builtin_popcountll(x);}
static inline unsigned clz(uint64_t x){return x?__builtin_clzll(x):64;}
static inline unsigned ctz(uint64_t x){return x?__builtin_ctzll(x):64;}
static inline uint64_t bswap(uint64_t x){return __builtin_bswap64(x);}

using Bytes32=std::array<uint8_t,32>;
¶»§q«^ bn,const uint8_t*c,size_t cn,const uint8_t*e,size_t en){return domain_hash(d,{{a,an},{b,bn},{c,cn},{e,en}});}
static Bytes32 h6(const char*d,const uint8_t*a,size_t an,const uint8_t*b,size_t bn,const uint8_t*c,size_t cn,const uint8_t*e,size_t en,const uint8_t*f,size_t fn,const uint8_t*g,size_t gn){return domain_hash(d,{{a,an},{b,bn},{c,cn},{e,en},{f,fn},{g,gn}});}

static std::array<Instr,PROGRAM_SIZE> expand_program(const Bytes32&seed){
  std::array<uint8_t,PROGRAM_SIZE*8> raw{}; size_t pos=0;
  for(uint32_t ctr=0;pos<raw.size();ctr++){
    uint8_t cb[4];wr32(cb,ctr);auto d=h2("FAE-RW5-PROGRAM",seed.data(),32,cb,4);
    size_t take=std::min<size_t>(32,raw.size()-pos);std::memcpy(raw.data()+pos,d.data(),take);pos+=take;
  }
  std::array<Instr,PROGRAM_SIZE> out{};
  for(uint32_t i=0;i<PROGRAM_SIZE;i++){
    auto*b=raw.data()+i*8;out[i]={uint8_t(b[0]&31),uint8_t(b[1]&7),uint8_t(b[2]&7),uint8_t(b[3]&7),rd32(b+4)};
  }
  return out;
}

static void rw5(const Bytes32&mh,const uint8_t hdr[32],uint64_t nonce,const uint8_t task[32],Bytes32&tr,std::array<uint64_t,8>&r,block*M){
  uint8_t nb[8];wr64(nb,nonce);
  auto base=h4("FAE-RW5-SEED",mh.data(),32,hdr,32,nb,8,task,32);
  auto*s=reinterpret_cast<uint64_t*>(M); const uint64_t mask=QWORDS-1;
  for(int i=0;i<8;i++){uint8_t tmp[8]={0};int st=i*4,n=32-st;if(n>8)n=8;if(n>0)std::memcpy(tmp,base.data()+st,n);r[i]=rd64(tmp);}
  tr=base; uint64_t chain=rd64(mh.data())^rd64(base.data()+8)^nonce^0xA0761D6478BD642FULL;
  for(uint32_t pidx=0;pidx¶»§q«^
        case 10:{uint64_t i1=(a^imm^r[dst])&mask,x=s[i1],i2=(x^b^rol(a,9))&mask;r[dst]+=x+s[i2];break;}
        case 11:{uint64_t i=(a^mulhi(b|1ULL,imm|1ULL)^r[dst])&mask;r[dst]^=s[i]*(b|1ULL);break;}
        case 12:{uint64_t i1=(a^r[dst]^imm)&mask,i2=(s[i1]^b)&mask;s[i2]=(s[i2]+r[dst])^rol(a,23);break;}
        case 13:r[dst]+=pop(a)+(uint64_t(pop(b))<<8)+imm;break;
        case 14:r[dst]^=uint64_t(clz(a))^(uint64_t(ctz(b))<<8)^imm;break;
        case 15:r[dst]=bswap(r[dst]^a)+imm;break;
        case 16:r[dst]+=(a|1ULL)*(b|1ULL)+imm;break;
        case 17:r[dst]^=(a^imm)*(b|1ULL);break;
        case 18:r[dst]+=mulhi(a+imm,b|1ULL);break;
        case 19:r[dst]^=rol(a+imm,b&63);break;
        case 20:r[dst]+=ror(b^imm,a&63);break;
        case 21:{uint64_t t=r[dst];r[dst]=r[src];r[src]=t;break;}
        case 22:if((b^imm)&1)r[dst]=a;else r[dst]+=rol(b,imm&63);break;
        case 23:{uint64_t sel=0ULL-((a^imm)&1ULL);r[dst]=(r[dst]&~sel)|(b&sel);break;}
        case 24:if(((r[dst]^a^imm)&3)==0)nxt=(pc+1+((b^imm)&0x1F))%PROGRAM_SIZE;r[dst]^=uint64_t(step)^pidx;break;
        case 25:if(((r[dst]^b^imm)&7)==0)nxt=(pc+1+((a^imm)&0x3F))%PROGRAM_SIZE;r[dst]+=step+rol(a,7);break;
        case 26:if(((a^b^r[dst])&15)==0)nxt=(pc+1+((r[src2]^imm)&0x7F))%PROGRAM_SIZE;r[dst]^=rol(b,19);break;
        case 27:{uint64_t bi=(a^b^imm^r[dst])&mask,bx=s[bi];if((bx&3)==0)nxt=(pc+1+((bx>>8)&0x3F))%PROGRAM_SIZE;r[dst]+=bx;break;}
        case 28:{uint64_t old=r[dst],sum=old+a,carry=sum<old;r[dst]=¶»§q«^ix]);}
    auto inner=h4("FAE-RW5-TRANSCRIPT",tr.data(),32,state,64,samples,64,pseed.data(),32);
    tr=shad(inner.data(),32);
  }
}

static bool argon_matrix(const Bytes32&pwd,const uint8_t salt[16],Bytes32&mh,block*&memory,argon2_context&ctx){
  ctx={};ctx.out=mh.data();ctx.outlen=32;ctx.pwd=const_cast<uint8_t*>(pwd.data());ctx.pwdlen=32;ctx.salt=const_cast<uint8_t*>(salt);ctx.saltlen=16;ctx.t_cost=1;ctx.m_cost=262144;ctx.lanes=1;ctx.threads=1;ctx.version=ARGON2_VERSION_13;ctx.flags=ARGON2_DEFAULT_FLAGS;
  argon2_instance_t inst{};inst.version=ctx.version;inst.passes=ctx.t_cost;inst.memory_blocks=262144;inst.segment_length=65536;inst.lane_length=262144;inst.lanes=1;inst.threads=1;inst.type=Argon2_d;
  if(initialize(&inst,&ctx)!=ARGON2_OK)return false;
  if(fill_memory_blocks(&inst)!=ARGON2_OK){free_memory(&ctx,reinterpret_cast<uint8_t*>(inst.memory),inst.memory_blocks,sizeof(block));return false;}
  uint8_t last[1024];for(int q=0;q<128;q++)wr64(last+8*q,inst.memory[inst.memory_blocks-1].v[q]);
  if(blake2b_long(mh.data(),32,last,sizeof(last))!=0){free_memory(&ctx,reinterpret_cast<uint8_t*>(inst.memory),inst.memory_blocks,sizeof(block));return false;}
  memory=inst.memory;return true;
}

static std::array<uint8_t,160> dp6(const uint8_t in[112]){
  const uint8_t*hdr=in;uint64_t nonce=rd64(in+32);const uint8_t*task=in+40,*prev=in+72;uint64_t height=rd64(in+104);
  uint8_t hb[8],nb[8];wr64(hb,height);wr64(nb,nonce);
  auto saltfull=h3("FAE-DP6-MH3-SALT",prev,32,hb,8,task,32);
 ¶»§q«^main(int argc,char**argv){
  uint64_t nonce=argc>1?std::strtoull(argv[1],nullptr,10):1200;
  uint8_t in[112]={0};hex("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",in,32);wr64(in+32,nonce);
  hex("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",in+40,32);std::memset(in+72,0x11,32);wr64(in+104,1001);
  auto out=dp6(in);
  std::printf("nonce=%llu\nmh=",(unsigned long long)nonce);printhex(out.data(),32);
  std::printf("\ntr=");printhex(out.data()+32,32);std::printf("\nregs=");printhex(out.data()+64,64);
  std::printf("\nfinal=");printhex(out.data()+128,32);std::printf("\n");
  if(nonce==1200){
    uint8_t want[160]={0};hex("5e863f7a72d0922c9e24583e2e9256104bdb0b390d0d779c84e716487d644211",want,32);
    hex("15cc8a8385b855d9a4cc1eea8ffe6b6fe470ea1680e5ade44414d505594662f4",want+32,32);
    uint64_t regs[8]={0x0cd21cc5fe20839eULL,0x36c782d357f08ec3ULL,0xc7ead5a8b8904395ULL,0xc15d8a47e6769f64ULL,0x1a22ad1cbcd709daULL,0x5824dc868e776b7dULL,0xa50f55a3e2455509ULL,0x385ffd011dd71d15ULL};for(int i=0;i<8;i++)wr64(want+64+8*i,regs[i]);
    hex("855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c",want+128,32);
    bool ok=std::memcmp(out.data(),want,160)==0;std::printf("canonical=%s\n",ok?"PASS":"FAIL");return ok?0:1;
  }
  return 0;
}
