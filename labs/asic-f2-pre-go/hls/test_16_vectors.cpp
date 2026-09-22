#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <chrono>
#include "fae_dp6_hls.cpp"
static bool hex2(const char* s, uint8_t* out, size_t n){for(size_t i=0;i<n;i++){unsigned x;if(std::sscanf(s+2*i,"%2x",&x)!=1)return false;out[i]=(uint8_t)x;}return true;}
static void put64le(uint8_t* p,uint64_t v){for(int i=0;i<8;i++)p[i]=(uint8_t)(v>>(8*i));}
int main(){
  static const char* expected[16]={
    "855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c","b8a5277d9226b434cf67b7bd40abbf6567855eecd21d87b8141ccb89b082053a","ac00df85fe2338d511b9fcae75dc509af92e2fde1ce19d9951e4f05c35e0799a","93d6481107e50261ea64a8042f2f11207f2124ab0653b2e60bd2ef7fb1e19b4d","578553a7ae9e9be5f3feb28986e4189f58a60bab22ba3cc92c8bf14c05de187d","b617b446eb572bd6dd2917f5e3538e386a329f748d6236f6955814751b75533c","09a62accdff0fe82f9afec271d5ae680e2b5a46aa50be87fa3b3b7f5923ca5ad","5c2fe9d4817efe787707146b2e201eb662acb6221444f70c7a5d5cb2361c34c6","e363839a9e82a7dfdd8283e937daf4488118faf3ba68b5f84be362dd95b57a23","3fd54b69b09a1d9a490788efe36b9f6969563a9b8b3cd4e64dcd9a0f75e850eb","caede732f1fa26c0812ebcf61403f63a0b6a4041a2ee524dee86e4d45682759b","7daf75d27daeacdce11b39394723a6d53e6bc48b6eddb2e76783f955ef4e7118","061c9994ebec724f4c230f45376ec7fcfaaec1db857b2abb4907c25bb1ad1574","1ecb554e1beea1f23b3d488439b9290fd9ba0172683b33a769016ff077d3cc30","ccc925c3901834d4dcc2c154ea80a786e79ccce0b56215ef5d55ecc02255244b","6197d3b23a9f7a52abee994b6bfb820965e7645a815d0170824af43a0d75164b"};
  uint8_t in[112]={0},out[160],want[32];
  hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",in,32);
  hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",in+40,32);
  hex2("1111111111111111111111111111111111111111111111111111111111111111",in+72,32);
  put64le(in+104,1001ULL);
  uint64_t* M=(uint64_t*)std::calloc(33554432ULL,sizeof(uint64_t));if(!M)return 3;
  int pass=0; auto all0=std::chrono::steady_clock::now();
  for(int i=0;i<16;i++){put64le(in+32,1200ULL+i);auto t0=std::chrono::steady_clock::now();fae_dp6_hls(in,out,M);auto t1=std::chrono::steady_clock::now();hex2(expected[i],want,32);bool ok=std::memcmp(out+128,want,32)==0;pass+=ok;std::printf("nonce=%d status=%s elapsed_s=%.6f\n",1200+i,ok?"PASS":"FAIL",std::chrono::duration<double>(t1-t0).count());}
  std::free(M);auto all1=std::chrono::steady_clock::now();
  std::printf("FAE_DP6_HLS_16VECTORS=%d/16 total_s=%.6f\n",pass,std::chrono::duration<double>(all1-all0).count());
  return pass==16?0:1;
}
