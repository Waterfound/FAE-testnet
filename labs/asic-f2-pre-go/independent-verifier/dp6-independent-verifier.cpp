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
¶»§q«^