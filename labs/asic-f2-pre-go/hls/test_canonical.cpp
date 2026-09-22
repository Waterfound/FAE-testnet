#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <string>
#include <chrono>
#include "fae_dp6_hls.cpp"

static bool hex2(const char* s, uint8_t* out, size_t n){
  for(size_t i=0;i<n;i++){ unsigned x; if(std::sscanf(s+2*i,"%2x",&x)!=1) return false; out[i]=(uint8_t)x; } return true;
}
static void put64le(uint8_t* p,uint64_t v){for(int i=0;i<8;i++)p[i]=(uint8_t)(v>>(8*i));}
static bool eqhex(const uint8_t* p,size_t n,const char* h){std::vector<uint8_t> q(n);return hex2(h,q.data(),n)&&std::memcmp(p,q.data(),n)==0;}
int main(){
  uint8_t in[112]={0}, out[160]={0};
  if(!hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",in,32)) return 2;
  put64le(in+32,1200ULL);
  if(!hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",in+40,32)) return 2;
  if(!hex2("1111111111111111111111111111111111111111111111111111111111111111",in+72,32)) return 2;
  put64le(in+104,1001ULL);
  const size_t qwords=33554432ULL;
  uint64_t* M=(uint64_t*)std::calloc(qwords,sizeof(uint64_t));
  if(!M){std::fprintf(stderr,"allocation failed\n");return 3;}
  auto t0=std::chrono::steady_clock::now();
  fae_dp6_hls(in,out,M);
  auto t1=std::chrono::steady_clock::now();
  std::free(M);
  bool ok=true;
  ok &= eqhex(out,32,"5e863f7a72d0922c9e24583e2e9256104bdb0b390d0d779c84e716487d644211");
  ok &= eqhex(out+32,32,"15cc8a8385b855d9a4cc1eea8ffe6b6fe470ea1680e5ade44414d505594662f4");
  const uint64_t regs[8]={0x0cd21cc5fe20839eULL,0x36c782d357f08ec3ULL,0xc7ead5a8b8904395ULL,0xc15d8a47e6769f64ULL,0x1a22ad1cbcd709daULL,0x5824dc868e776b7dULL,0xa50f55a3e2455509ULL,0x385ffd011dd71d15ULL};
  for(int i=0;i<8;i++){uint8_t q[8];put64le(q,regs[i]);ok &= std::memcmp(out+64+8*i,q,8)==0;}
  ok &= eqhex(out+128,32,"855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c");
  double sec=std::chrono::duration<double>(t1-t0).count();
  std::printf("FAE_DP6_HLS_CANONICAL=%s elapsed_s=%.6f\n",ok?"PASS":"FAIL",sec);
  return ok?0:1;
}