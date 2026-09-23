/*
 * FAE-DP6 v0.7 frozen semantics — HLS portability candidate for AWS F2 PRE-GO.
 * Derived mechanically from fae_dp6_opencl_g3.cl SHA-256
 * 4230a4a3f8c0b987e344ce3714faf6735e83beb666085e99add8b0392081d070.
 * Research only. No consensus authority, wallet, testnet, or block submission.
 */
/* FAE-DP6 v0.8 G3 OpenCL correctness backend.
 * One complete DP6 work per OpenCL work-item. Host supplies 256 MiB matrix per item.
 * Correctness candidate only: NOT G4 optimized evidence and NOT consensus change. */
#include <stdint.h>
#include <stddef.h>
#define PROGRAMS 8u
#define PROGRAM_SIZE 256u
#define STEPS 131072u
#define ARGON_BLOCKS 262144u
#define ARGON_BLOCK_BYTES 1024u
#define ARGON_QWORDS 128u
#define ARGON_SEGMENT 65536u
#define FAE_DP6_INPUT_BYTES 112u
#define FAE_DP6_OUTPUT_BYTES 160u

typedef struct { uint64_t v[ARGON_QWORDS]; } block;
typedef struct { uint8_t op,dst,src,src2; uint32_t imm; } Ins;

/* Matrix is supplied by host: 262144 blocks (256 MiB) per work-item. */

/* -------- freestanding byte primitives -------- */
void *fae_memcpy(void *dst, const void *src, size_t n){
    uint8_t *d=(uint8_t*)dst; const uint8_t *s=(const uint8_t*)src;
    for(size_t i=0;i<n;i++) d[i]=s[i]; return dst;
}
void *fae_memset(void *dst, int c, size_t n){
    uint8_t *d=(uint8_t*)dst; for(size_t i=0;i<n;i++) d[i]=(uint8_t)c; return dst;
}
static int memeq(const void*a,const void*b,size_t n){const uint8_t*x=(const uint8_t*)a,*y=(const uint8_t*)b;uint8_t q=0;for(size_t i=0;i<n;i++)q|=x[i]^y[i];return q==0;}

static inline uint32_t rd32(const uint8_t*p){return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);}
static inline uint64_t rd64(const uint8_t*p){return (uint64_t)rd32(p)|((uint64_t)rd32(p+4)<<32);}
static inline void wr32(uint8_t*p,uint32_t x){p[0]=(uint8_t)x;p[1]=(uint8_t)(x>>8);p[2]=(uint8_t)(x>>16);p[3]=(uint8_t)(x>>24);}
static inline void wr64(uint8_t*p,uint64_t x){wr32(p,(uint32_t)x);wr32(p+4,(uint32_t)(x>>32));}
static inline uint64_t rotl64(uint64_t x,unsigned n){n&=63;return (x<<n)|(x>>((-n)&63));}
static inline uint64_t rotr64(uint64_t x,unsigned n){n&=63;return (x>>n)|(x<<((-n)&63));}
static inline uint32_t rotr32(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
static inline uint64_t mulh64(uint64_t a,uint64_t b){
    uint64_t a0=(uint32_t)a,a1=a>>32,b0=(uint32_t)b,b1=b>>32;
    uint64_t w0=a0*b0;
    uint64_t t=a1*b0+(w0>>32);
    uint64_t w1=(uint32_t)t, w2=t>>32;
    w1 += a0*b1;
    return a1*b1+w2+(w1>>32);
}
static inline uint64_t bswap64x(uint64_t x){
    return ((x&0x00000000000000ffULL)<<56)|((x&0x000000000000ff00ULL)<<40)|
           ((x&0x0000000000ff0000ULL)<<24)|((x&0x00000000ff000000ULL)<<8)|
           ((x&0x000000ff00000000ULL)>>8)|((x&0x0000ff0000000000ULL)>>24)|
           ((x&0x00ff000000000000ULL)>>40)|((x&0xff00000000000000ULL)>>56);
}
static inline unsigned pop64(uint64_t x){unsigned n=0;while(x){x&=x-1;n++;}return n;}
static inline unsigned clz64x(uint64_t x){if(!x)return 64u;unsigned n=0;for(uint64_t m=((uint64_t)1)<<63;!(x&m);m>>=1)n++;return n;}
static inline unsigned ctz64x(uint64_t x){if(!x)return 64u;unsigned n=0;while((x&1UL)==0){x>>=1;n++;}return n;}

/* -------- SHA-256 -------- */
typedef struct { uint32_t h[8]; uint64_t bytes; uint8_t buf[64]; uint32_t used; } sha256_ctx;
uint32_t K256[64]={
0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};
static inline uint32_t be32(const uint8_t*p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static void sha256_compress(sha256_ctx*c,const uint8_t*b){
#pragma HLS INLINE off

 uint32_t w[64];for(int i=0;i<16;i++)w[i]=be32(b+4*i);for(int i=16;i<64;i++){uint32_t x=w[i-15],y=w[i-2];uint32_t s0=rotr32(x,7)^rotr32(x,18)^(x>>3),s1=rotr32(y,17)^rotr32(y,19)^(y>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
 uint32_t a=c->h[0],d=c->h[3],e=c->h[4],h=c->h[7],bb=c->h[1],cc=c->h[2],f=c->h[5],g=c->h[6];
 for(int i=0;i<64;i++){uint32_t S1=rotr32(e,6)^rotr32(e,11)^rotr32(e,25),ch=(e&f)^((~e)&g),t1=h+S1+ch+K256[i]+w[i];uint32_t S0=rotr32(a,2)^rotr32(a,13)^rotr32(a,22),maj=(a&bb)^(a&cc)^(bb&cc),t2=S0+maj;h=g;g=f;f=e;e=d+t1;d=cc;cc=bb;bb=a;a=t1+t2;}
 c->h[0]+=a;c->h[1]+=bb;c->h[2]+=cc;c->h[3]+=d;c->h[4]+=e;c->h[5]+=f;c->h[6]+=g;c->h[7]+=h;
}
uint32_t SHAIV[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u};
static void sha256_init(sha256_ctx*c){for(int i=0;i<8;i++)c->h[i]=SHAIV[i];c->bytes=0;c->used=0;}
static void sha256_update(sha256_ctx*c,const void*vp,size_t n){
#pragma HLS INLINE off
const uint8_t*p=(const uint8_t*)vp;c->bytes+=n;while(n){size_t t=64-c->used;if(t>n)t=n;fae_memcpy(c->buf+c->used,p,t);c->used+=(uint32_t)t;p+=t;n-=t;if(c->used==64){sha256_compress(c,c->buf);c->used=0;}}}
static void sha256_update_const(sha256_ctx*c,const uint8_t*p,size_t n){uint8_t tmp[64];while(n){size_t t=n<64?n:64;for(size_t i=0;i<t;i++)tmp[i]=p[i];sha256_update(c,tmp,t);p+=t;n-=t;}}
static void sha256_final(sha256_ctx*c,uint8_t out[32]){
#pragma HLS INLINE off
uint64_t bits=c->bytes*8;c->buf[c->used++]=0x80;if(c->used>56){fae_memset(c->buf+c->used,0,64-c->used);sha256_compress(c,c->buf);c->used=0;}fae_memset(c->buf+c->used,0,56-c->used);for(int i=0;i<8;i++)c->buf[63-i]=(uint8_t)(bits>>(8*i));sha256_compress(c,c->buf);for(int i=0;i<8;i++){out[4*i]=(uint8_t)(c->h[i]>>24);out[4*i+1]=(uint8_t)(c->h[i]>>16);out[4*i+2]=(uint8_t)(c->h[i]>>8);out[4*i+3]=(uint8_t)c->h[i];}}
static void sha(const uint8_t*p,size_t n,uint8_t out[32]){sha256_ctx c;sha256_init(&c);sha256_update(&c,p,n);sha256_final(&c,out);}
static void shad(const uint8_t*p,size_t n,uint8_t out[32]){uint8_t t[32];sha(p,n,t);sha(t,32,out);}
static size_t cstrlen(const char*s){size_t n=0;while(s[n])n++;return n;}
static void hd_init(sha256_ctx*c,const char*d){sha256_init(c);size_t dl=cstrlen(d);uint8_t db[2]={(uint8_t)dl,(uint8_t)(dl>>8)};sha256_update(c,db,2);sha256_update_const(c,(const uint8_t*)d,dl);}
static void hd_part(sha256_ctx*c,const uint8_t*p,size_t n){uint8_t nb[8];wr64(nb,(uint64_t)n);sha256_update(c,nb,8);if(n)sha256_update(c,p,n);}
static void h2(const char*d,const uint8_t*a,size_t an,const uint8_t*b,size_t bn,uint8_t o[32]){sha256_ctx c;hd_init(&c,d);hd_part(&c,a,an);hd_part(&c,b,bn);sha256_final(&c,o);}
static void h3(const char*d,const uint8_t*a,size_t an,const uint8_t*b,size_t bn,const uint8_t*c0,size_t cn,uint8_t o[32]){sha256_ctx c;hd_init(&c,d);hd_part(&c,a,an);hd_part(&c,b,bn);hd_part(&c,c0,cn);sha256_final(&c,o);}
static void h4(const char*d,const uint8_t*a,size_t an,const uint8_t*b,size_t bn,const uint8_t*c0,size_t cn,const uint8_t*e,size_t en,uint8_t o[32]){sha256_ctx c;hd_init(&c,d);hd_part(&c,a,an);hd_part(&c,b,bn);hd_part(&c,c0,cn);hd_part(&c,e,en);sha256_final(&c,o);}
static void h6(const char*d,const uint8_t*a,size_t an,const uint8_t*b,size_t bn,const uint8_t*c0,size_t cn,const uint8_t*e,size_t en,const uint8_t*f,size_t fn,const uint8_t*g,size_t gn,uint8_t o[32]){sha256_ctx c;hd_init(&c,d);hd_part(&c,a,an);hd_part(&c,b,bn);hd_part(&c,c0,cn);hd_part(&c,e,en);hd_part(&c,f,fn);hd_part(&c,g,gn);sha256_final(&c,o);} 

/* -------- BLAKE2b (unkeyed, enough for Argon2 H0/H') -------- */
typedef struct {uint64_t h[8],t[2],f[2];uint8_t buf[128];size_t buflen,outlen;} b2ctx;
uint64_t B2IV[8]={0x6a09e667f3bcc908ULL,0xbb67ae8584caa73bULL,0x3c6ef372fe94f82bULL,0xa54ff53a5f1d36f1ULL,0x510e527fade682d1ULL,0x9b05688c2b3e6c1fULL,0x1f83d9abfb41bd6bULL,0x5be0cd19137e2179ULL};
uint8_t B2SIG[12][16]={
{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},{14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3},{11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4},{7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8},{9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13},{2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9},{12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11},{13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10},{6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5},{10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0},{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},{14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3}};
#define B2G(a,b,c,d,x,y) do{a=a+b+x;d=rotr64(d^a,32);c=c+d;b=rotr64(b^c,24);a=a+b+y;d=rotr64(d^a,16);c=c+d;b=rotr64(b^c,63);}while(0)
static void b2compress(b2ctx*S,const uint8_t*in){
#pragma HLS INLINE off
uint64_t m[16],v[16];for(int i=0;i<16;i++)m[i]=rd64(in+8*i);for(int i=0;i<8;i++)v[i]=S->h[i];v[8]=B2IV[0];v[9]=B2IV[1];v[10]=B2IV[2];v[11]=B2IV[3];v[12]=B2IV[4]^S->t[0];v[13]=B2IV[5]^S->t[1];v[14]=B2IV[6]^S->f[0];v[15]=B2IV[7]^S->f[1];for(int r=0;r<12;r++){const uint8_t*s=B2SIG[r];B2G(v[0],v[4],v[8],v[12],m[s[0]],m[s[1]]);B2G(v[1],v[5],v[9],v[13],m[s[2]],m[s[3]]);B2G(v[2],v[6],v[10],v[14],m[s[4]],m[s[5]]);B2G(v[3],v[7],v[11],v[15],m[s[6]],m[s[7]]);B2G(v[0],v[5],v[10],v[15],m[s[8]],m[s[9]]);B2G(v[1],v[6],v[11],v[12],m[s[10]],m[s[11]]);B2G(v[2],v[7],v[8],v[13],m[s[12]],m[s[13]]);B2G(v[3],v[4],v[9],v[14],m[s[14]],m[s[15]]);}for(int i=0;i<8;i++)S->h[i]^=v[i]^v[i+8];}
#undef B2G
static void b2init(b2ctx*S,size_t outlen){for(int i=0;i<8;i++)S->h[i]=B2IV[i];S->h[0]^=0x01010000ULL^(uint64_t)outlen;S->t[0]=S->t[1]=S->f[0]=S->f[1]=0;S->buflen=0;S->outlen=outlen;}
static void b2inc(b2ctx*S,uint64_t n){S->t[0]+=n;if(S->t[0]<n)S->t[1]++;}
static void b2update(b2ctx*S,const void*vp,size_t n){
#pragma HLS INLINE off
const uint8_t*p=(const uint8_t*)vp;if(!n)return;if(S->buflen+n>128){size_t left=S->buflen,fill=128-left;fae_memcpy(S->buf+left,p,fill);b2inc(S,128);b2compress(S,S->buf);S->buflen=0;p+=fill;n-=fill;while(n>128){b2inc(S,128);b2compress(S,p);p+=128;n-=128;}}fae_memcpy(S->buf+S->buflen,p,n);S->buflen+=n;}
static void b2final(b2ctx*S,uint8_t*out){
#pragma HLS INLINE off
b2inc(S,S->buflen);S->f[0]=(~(uint64_t)0);fae_memset(S->buf+S->buflen,0,128-S->buflen);b2compress(S,S->buf);uint8_t tmp[64];for(int i=0;i<8;i++)wr64(tmp+8*i,S->h[i]);fae_memcpy(out,tmp,S->outlen);}
static void blake2b(uint8_t*out,size_t outlen,const void*in,size_t inlen){b2ctx s;b2init(&s,outlen);b2update(&s,in,inlen);b2final(&s,out);}
static void blake2b_long(uint8_t*out,size_t outlen,const void*in,size_t inlen){
#pragma HLS INLINE off
uint8_t olen[4];wr32(olen,(uint32_t)outlen);if(outlen<=64){b2ctx s;b2init(&s,outlen);b2update(&s,olen,4);b2update(&s,in,inlen);b2final(&s,out);return;}uint8_t ob[64],ib[64];b2ctx s;b2init(&s,64);b2update(&s,olen,4);b2update(&s,in,inlen);b2final(&s,ob);fae_memcpy(out,ob,32);out+=32;uint32_t todo=(uint32_t)outlen-32;while(todo>64){fae_memcpy(ib,ob,64);blake2b(ob,64,ib,64);fae_memcpy(out,ob,32);out+=32;todo-=32;}fae_memcpy(ib,ob,64);blake2b(ob,todo,ib,64);fae_memcpy(out,ob,todo);}

/* -------- fixed Argon2d v1.3, m=256 MiB,t=1,p=1,out=32 -------- */
static inline uint64_t blamka(uint64_t x,uint64_t y){uint64_t xy=(x&0xffffffffULL)*(y&0xffffffffULL);return x+y+2*xy;}
#define AG(a,b,c,d) do{a=blamka(a,b);d=rotr64(d^a,32);c=blamka(c,d);b=rotr64(b^c,24);a=blamka(a,b);d=rotr64(d^a,16);c=blamka(c,d);b=rotr64(b^c,63);}while(0)
#define AROUND(v0,v1,v2,v3,v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v14,v15) do{AG(v0,v4,v8,v12);AG(v1,v5,v9,v13);AG(v2,v6,v10,v14);AG(v3,v7,v11,v15);AG(v0,v5,v10,v15);AG(v1,v6,v11,v12);AG(v2,v7,v8,v13);AG(v3,v4,v9,v14);}while(0)
static void fill_block(const block*prev,const block*ref,block*next){
#pragma HLS INLINE off
block r,t;for(int i=0;i<128;i++){r.v[i]=ref->v[i]^prev->v[i];t.v[i]=r.v[i];}for(int i=0;i<8;i++){uint64_t*x=&r.v[16*i];AROUND(x[0],x[1],x[2],x[3],x[4],x[5],x[6],x[7],x[8],x[9],x[10],x[11],x[12],x[13],x[14],x[15]);}for(int i=0;i<8;i++){AROUND(r.v[2*i],r.v[2*i+1],r.v[2*i+16],r.v[2*i+17],r.v[2*i+32],r.v[2*i+33],r.v[2*i+48],r.v[2*i+49],r.v[2*i+64],r.v[2*i+65],r.v[2*i+80],r.v[2*i+81],r.v[2*i+96],r.v[2*i+97],r.v[2*i+112],r.v[2*i+113]);}for(int i=0;i<128;i++)next->v[i]=t.v[i]^r.v[i];}
#undef AG
#undef AROUND
static uint32_t index_alpha0(uint32_t slice,uint32_t i,uint32_t pseudo){uint32_t area=(slice==0)?(i-1):(slice*ARGON_SEGMENT+i-1);uint64_t rel=(uint64_t)pseudo*(uint64_t)pseudo;rel>>=32;rel=(uint64_t)area-1-(((uint64_t)area*rel)>>32);return (uint32_t)rel;}
static void argon2d_fixed(const uint8_t pwd[32],const uint8_t salt[16],uint8_t out[32],block*M){
#pragma HLS INLINE off

    /* H0 = Blake2b-512(LE32(p)||LE32(T)||LE32(m)||LE32(t)||LE32(v)||LE32(y)||fields...) */
    uint8_t h0[64],v4[4]; b2ctx h;b2init(&h,64);
    uint32_t vals[6]={1u,32u,262144u,1u,0x13u,0u};for(int i=0;i<6;i++){wr32(v4,vals[i]);b2update(&h,v4,4);}wr32(v4,32);b2update(&h,v4,4);b2update(&h,pwd,32);wr32(v4,16);b2update(&h,v4,4);b2update(&h,salt,16);wr32(v4,0);b2update(&h,v4,4);wr32(v4,0);b2update(&h,v4,4);b2final(&h,h0);
    uint8_t seed[72],bb[1024];fae_memcpy(seed,h0,64);wr32(seed+68,0);wr32(seed+64,0);blake2b_long(bb,1024,seed,72);for(int j=0;j<128;j++)M[0].v[j]=rd64(bb+8*j);wr32(seed+64,1);blake2b_long(bb,1024,seed,72);for(int j=0;j<128;j++)M[1].v[j]=rd64(bb+8*j);
    for(uint32_t slice=0;slice<4;slice++){uint32_t start=(slice==0)?2:0;uint32_t curr=slice*ARGON_SEGMENT+start;for(uint32_t i=start;i<ARGON_SEGMENT;i++,curr++){uint32_t prev=curr-1;uint64_t pr=M[prev].v[0];uint32_t ref=index_alpha0(slice,i,(uint32_t)pr);fill_block(&M[prev],&M[ref],&M[curr]);}}
    for(int j=0;j<128;j++)wr64(bb+8*j,M[ARGON_BLOCKS-1].v[j]);blake2b_long(out,32,bb,1024);
}

/* -------- frozen RW5 -------- */
static void expand_program(const uint8_t seed[32],Ins prog[PROGRAM_SIZE]){
#pragma HLS INLINE off
uint8_t raw[PROGRAM_SIZE*8];size_t pos=0;for(uint32_t ctr=0;pos<sizeof raw;ctr++){uint8_t cb[4],d[32];wr32(cb,ctr);h2("FAE-RW5-PROGRAM",seed,32,cb,4,d);size_t take=sizeof(raw)-pos<32?sizeof(raw)-pos:32;fae_memcpy(raw+pos,d,take);pos+=take;}for(uint32_t i=0;i<PROGRAM_SIZE;i++){uint8_t*b=raw+i*8;prog[i]=Ins{(uint8_t)(b[0]&31),(uint8_t)(b[1]&7),(uint8_t)(b[2]&7),(uint8_t)(b[3]&7),rd32(b+4)};}}
static void rw5(const uint8_t mh[32],const uint8_t hdr[32],uint64_t nonce,const uint8_t task[32],uint8_t tr[32],uint64_t r[8],block*M){
#pragma HLS INLINE off
#pragma HLS ARRAY_PARTITION variable=r complete dim=1
uint8_t nb[8],base[32];wr64(nb,nonce);h4("FAE-RW5-SEED",mh,32,hdr,32,nb,8,task,32,base);uint64_t*s=(uint64_t*)M;const uint64_t mask=(256u*1024u*1024u/8u)-1u;for(int i=0;i<8;i++){uint8_t tmp[8]={0};int st=i*4,n=32-st;if(n>8)n=8;if(n>0)fae_memcpy(tmp,base+st,(size_t)n);r[i]=rd64(tmp);}fae_memcpy(tr,base,32);uint64_t chain=rd64(mh)^rd64(base+8)^nonce^0xA0761D6478BD642FULL;
for(uint32_t pidx=0;pidx<PROGRAMS;pidx++){uint8_t pi[4],pseed[32];wr32(pi,pidx);h3("FAE-RW5-CHAIN",tr,32,pi,4,mh,32,pseed);Ins prog[PROGRAM_SIZE];expand_program(pseed,prog);uint32_t pc=rd32(pseed)%PROGRAM_SIZE;
for(uint32_t step=0;step<STEPS;step++){Ins q=prog[pc];uint8_t op=q.op,dst=q.dst,src=q.src,src2=q.src2;uint64_t imm=q.imm,a=r[src],b=r[src2];uint32_t nxt=(pc+1)%PROGRAM_SIZE;
switch(op){
case 0:r[dst]+=a+imm;break;case 1:r[dst]^=a^imm;break;case 2:r[dst]-=a+imm;break;case 3:r[dst]=(r[dst]|1ULL)*(a|1ULL)+imm;break;case 4:r[dst]=mulh64(r[dst]^imm,a|1ULL)+b;break;case 5:r[dst]=rotl64(r[dst]^a,(b^imm)&63);break;case 6:r[dst]=rotr64(r[dst]+a,(b+imm)&63);break;
case 7:{uint64_t den=(a^b^imm)|1ULL,orig=r[dst];r[dst]=(orig/den)^(orig%den)^b;break;}case 8:{uint64_t i=(a^rotl64(b,17)^imm^r[dst])&mask;r[dst]+=s[i];break;}case 9:{uint64_t i=(r[dst]^a^(imm*0x9E3779B1ULL))&mask;s[i]^=b^rotl64(r[dst],11);break;}case 10:{uint64_t i1=(a^imm^r[dst])&mask,x=s[i1],i2=(x^b^rotl64(a,9))&mask;r[dst]+=x+s[i2];break;}case 11:{uint64_t i=(a^mulh64(b|1ULL,imm|1ULL)^r[dst])&mask;r[dst]^=s[i]*(b|1ULL);break;}case 12:{uint64_t i1=(a^r[dst]^imm)&mask,i2=(s[i1]^b)&mask;s[i2]=(s[i2]+r[dst])^rotl64(a,23);break;}case 13:r[dst]+=pop64(a)+((uint64_t)pop64(b)<<8)+imm;break;case 14:r[dst]^=(uint64_t)clz64x(a)^((uint64_t)ctz64x(b)<<8)^imm;break;case 15:r[dst]=bswap64x(r[dst]^a)+imm;break;case 16:r[dst]+=(a|1ULL)*(b|1ULL)+imm;break;case 17:r[dst]^=(a^imm)*(b|1ULL);break;case 18:r[dst]+=mulh64(a+imm,b|1ULL);break;case 19:r[dst]^=rotl64(a+imm,b&63);break;case 20:r[dst]+=rotr64(b^imm,a&63);break;case 21:{uint64_t t=r[dst];r[dst]=r[src];r[src]=t;break;}case 22:if((b^imm)&1)r[dst]=a;else r[dst]+=rotl64(b,imm&63);break;case 23:{uint64_t sel=0ULL-((a^imm)&1ULL);r[dst]=(r[dst]&~sel)|(b&sel);break;}case 24:if(((r[dst]^a^imm)&3)==0)nxt=(pc+1+((b^imm)&0x1F))%PROGRAM_SIZE;r[dst]^=(uint64_t)step^pidx;break;case 25:if(((r[dst]^b^imm)&7)==0)nxt=(pc+1+((a^imm)&0x3F))%PROGRAM_SIZE;r[dst]+=step+rotl64(a,7);break;case 26:if(((a^b^r[dst])&15)==0)nxt=(pc+1+((r[src2]^imm)&0x7F))%PROGRAM_SIZE;r[dst]^=rotl64(b,19);break;case 27:{uint64_t bi=(a^b^imm^r[dst])&mask,bx=s[bi];if((bx&3)==0)nxt=(pc+1+((bx>>8)&0x3F))%PROGRAM_SIZE;r[dst]+=bx;break;}case 28:{uint64_t old=r[dst],sum=old+a,carry=sum<old;r[dst]=old+a+imm+carry+(b&1);break;}case 29:{uint64_t x=r[dst]^a^imm;x=(x^(x>>29))*0x9FB21C651E98DF25ULL;r[dst]=rotl64(x,(unsigned)((b>>58)+1))^b;break;}case 30:{uint64_t i1=(a^imm^r[dst])&mask,x1=s[i1],i2=(x1^b^rotl64(a,13))&mask,x2=s[i2],i3=(x2^r[src2]^rotl64(x1,21))&mask;r[dst]+=x1+x2+s[i3];break;}default:if((a^b^imm)&1)r[dst]=mulh64(r[dst]|1ULL,a|1ULL)^rotl64(b,17);else r[dst]=(r[dst]+a)^rotr64(b+imm,23);break;}
uint64_t mi=(chain^r[dst]^rotl64(r[src],17)^((uint64_t)step*0xD6E8FEB86659FD93ULL))&mask;uint64_t mv=s[mi];chain=rotl64(chain^mv^r[src2]^imm,(unsigned)(((mv>>58)+5)&63));chain=chain*0x9E3779B97F4A7C15ULL+((uint64_t)pidx<<32)+step;r[src2]^=mv^chain;r[dst]+=mulh64(chain|1ULL,mv|1ULL);s[mi]=rotl64(mv+r[dst]+chain+step,(unsigned)(((chain>>59)+1)&63));pc=nxt;}
r[7]^=chain;uint8_t state[64],samples[64],inner[32];for(int i=0;i<8;i++)wr64(state+8*i,r[i]);for(int i=0;i<8;i++){uint64_t ix=(r[i]^r[(i+3)&7])&mask;wr64(samples+8*i,s[ix]);}h4("FAE-RW5-TRANSCRIPT",tr,32,state,64,samples,64,pseed,32,inner);shad(inner,32,tr);}}

static int dp6_run_bytes(const uint8_t in[112],uint8_t out[160],block*M){
#pragma HLS INLINE off
const uint8_t*hdr=in;uint64_t nonce=rd64(in+32);const uint8_t*task=in+40;const uint8_t*prev=in+72;uint64_t height=rd64(in+104);uint8_t hb[8],saltfull[32],nb[8],pwd[32],mh[32],tr[32],inner[32],final[32],regbytes[64];uint64_t regs[8];
#pragma HLS ARRAY_PARTITION variable=regs complete dim=1
wr64(hb,height);h3("FAE-DP6-MH3-SALT",prev,32,hb,8,task,32,saltfull);wr64(nb,nonce);h3("FAE-DP6-MH3-INPUT",hdr,32,nb,8,task,32,pwd);argon2d_fixed(pwd,saltfull,mh,M);rw5(mh,hdr,nonce,task,tr,regs,M);for(int i=0;i<8;i++)wr64(regbytes+8*i,regs[i]);h6("FAE-DP6-FINAL",hdr,32,nb,8,task,32,mh,32,tr,32,regbytes,64,inner);shad(inner,32,final);fae_memcpy(out,mh,32);fae_memcpy(out+32,tr,32);fae_memcpy(out+64,regbytes,64);fae_memcpy(out+128,final,32);return 0;}


extern "C" void fae_dp6_hls(const uint8_t *input, uint8_t *output, uint64_t *matrix_words) {
#pragma HLS INTERFACE m_axi port=input offset=slave bundle=gmem0 depth=112
#pragma HLS INTERFACE m_axi port=output offset=slave bundle=gmem0 depth=160
#pragma HLS INTERFACE m_axi port=matrix_words offset=slave bundle=gmem1 depth=33554432
#pragma HLS INTERFACE s_axilite port=input bundle=control
#pragma HLS INTERFACE s_axilite port=output bundle=control
#pragma HLS INTERFACE s_axilite port=matrix_words bundle=control
#pragma HLS INTERFACE s_axilite port=return bundle=control
    uint8_t in_local[FAE_DP6_INPUT_BYTES];
    uint8_t out_local[FAE_DP6_OUTPUT_BYTES];
    for (uint32_t i=0;i<FAE_DP6_INPUT_BYTES;i++) in_local[i]=input[i];
    block *M = (block*)matrix_words;
    dp6_run_bytes(in_local,out_local,M);
    for (uint32_t i=0;i<FAE_DP6_OUTPUT_BYTES;i++) output[i]=out_local[i];
}
