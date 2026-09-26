#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>

#include "fpga_pci.h"
#include "fpga_mgmt.h"
#include "utils/lcd.h"

#define SLOT_ID 0
#define CTRL_AP       0x00
#define CTRL_INPUT_LO 0x10
#define CTRL_INPUT_HI 0x14
#define CTRL_OUTPUT_LO 0x1c
#define CTRL_OUTPUT_HI 0x20
#define CTRL_MATRIX_LO 0x28
#define CTRL_MATRIX_HI 0x2c

/* PCIS/BAR4 DDR base is 0.  The FAE master sees the same DDRA at 0x1000000000. */
#define HOST_DDR_INPUT_OFF   0x00000000ULL
#define HOST_DDR_OUTPUT_OFF  0x00001000ULL
#define FAE_DDRA_BASE        0x1000000000ULL
#define FAE_INPUT_ADDR       (FAE_DDRA_BASE + HOST_DDR_INPUT_OFF)
#define FAE_OUTPUT_ADDR      (FAE_DDRA_BASE + HOST_DDR_OUTPUT_OFF)
#define FAE_MATRIX_ADDR      (FAE_DDRA_BASE + 0x01000000ULL)

static int hex2(const char *s, uint8_t *out, size_t n) {
    for (size_t i=0;i<n;i++) {
        unsigned x=0;
        if (sscanf(s+2*i,"%2x",&x)!=1) return -1;
        out[i]=(uint8_t)x;
    }
    return 0;
}
static void put64le(uint8_t *p, uint64_t v) {
    for (int i=0;i<8;i++) p[i]=(uint8_t)(v>>(8*i));
}
static void print_hex(const uint8_t *p,size_t n) {
    for(size_t i=0;i<n;i++) printf("%02x",p[i]);
}
static int poke64split(pci_bar_handle_t h,uint64_t off,uint64_t v) {
    int rc=fpga_pci_poke(h,off,(uint32_t)v);
    if(rc) return rc;
    return fpga_pci_poke(h,off+4,(uint32_t)(v>>32));
}
static int bar4_write_bytes(pci_bar_handle_t h,uint64_t off,const uint8_t *p,size_t n) {
    if((n&3)!=0) return -1;
    uint32_t *tmp=calloc(n/4,sizeof(uint32_t));
    if(!tmp) return -1;
    memcpy(tmp,p,n);
    int rc=fpga_pci_write_burst(h,off,tmp,n/4);
    free(tmp);
    return rc;
}
static int bar4_read_bytes(pci_bar_handle_t h,uint64_t off,uint8_t *p,size_t n) {
    if((n&3)!=0) return -1;
    for(size_t i=0;i<n/4;i++) {
        uint32_t v=0;
        int rc=fpga_pci_peek(h,off+4*i,&v);
        if(rc) return rc;
        memcpy(p+4*i,&v,4);
    }
    return 0;
}
static int run_once(pci_bar_handle_t ocl,pci_bar_handle_t mem,const uint8_t in[112],uint8_t out[160],double *elapsed_s) {
    int rc;
    uint32_t ctrl=0;
    rc=bar4_write_bytes(mem,HOST_DDR_INPUT_OFF,in,112); if(rc) return rc;
    rc=fpga_pci_memset(mem,HOST_DDR_OUTPUT_OFF,0,40); if(rc) return rc;

    rc=poke64split(ocl,CTRL_INPUT_LO,FAE_INPUT_ADDR); if(rc) return rc;
    rc=poke64split(ocl,CTRL_OUTPUT_LO,FAE_OUTPUT_ADDR); if(rc) return rc;
    rc=poke64split(ocl,CTRL_MATRIX_LO,FAE_MATRIX_ADDR); if(rc) return rc;

    struct timespec t0,t1;
    clock_gettime(CLOCK_MONOTONIC,&t0);
    rc=fpga_pci_poke(ocl,CTRL_AP,1); if(rc) return rc;

    const int max_polls=600000; /* 10 minutes at 1 ms */
    int done=0;
    for(int i=0;i<max_polls;i++) {
        rc=fpga_pci_peek(ocl,CTRL_AP,&ctrl); if(rc) return rc;
        if(ctrl & 0x2) { done=1; break; }
        usleep(1000);
    }
    clock_gettime(CLOCK_MONOTONIC,&t1);
    if(!done) {
        fprintf(stderr,"RUNTIME_TIMEOUT ctrl=0x%08x\n",ctrl);
        return 124;
    }
    *elapsed_s=(double)(t1.tv_sec-t0.tv_sec)+(double)(t1.tv_nsec-t0.tv_nsec)/1e9;
    return bar4_read_bytes(mem,HOST_DDR_OUTPUT_OFF,out,160);
}

int main(void) {
    int rc=0;
    pci_bar_handle_t ocl=PCI_BAR_HANDLE_INIT, mem=PCI_BAR_HANDLE_INIT;
    uint8_t in[112]={0},out[160]={0},want[160]={0},want32[32]={0};

    static const char *expected_final[16]={
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
      "6197d3b23a9f7a52abee994b6bfb820965e7645a815d0170824af43a0d75164b"
    };

    if(hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",in,32)) return 2;
    if(hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",in+40,32)) return 2;
    if(hex2("1111111111111111111111111111111111111111111111111111111111111111",in+72,32)) return 2;
    put64le(in+104,1001ULL);

    rc=fpga_mgmt_init(); if(rc) goto out;
    rc=fpga_pci_attach(SLOT_ID,FPGA_APP_PF,APP_PF_BAR0,0,&ocl); if(rc) goto out;
    rc=fpga_pci_attach(SLOT_ID,FPGA_APP_PF,APP_PF_BAR4,BURST_CAPABLE,&mem); if(rc) goto out;

    /* Canonical full 160-byte vector. */
    put64le(in+32,1200ULL);
    double sec=0;
    rc=run_once(ocl,mem,in,out,&sec); if(rc) goto out;

    hex2("5e863f7a72d0922c9e24583e2e9256104bdb0b390d0d779c84e716487d644211",want,32);
    hex2("15cc8a8385b855d9a4cc1eea8ffe6b6fe470ea1680e5ade44414d505594662f4",want+32,32);
    const uint64_t regs[8]={0x0cd21cc5fe20839eULL,0x36c782d357f08ec3ULL,0xc7ead5a8b8904395ULL,0xc15d8a47e6769f64ULL,0x1a22ad1cbcd709daULL,0x5824dc868e776b7dULL,0xa50f55a3e2455509ULL,0x385ffd011dd71d15ULL};
    for(int i=0;i<8;i++)put64le(want+64+8*i,regs[i]);
    hex2(expected_final[0],want+128,32);

    int canonical_ok=(memcmp(out,want,160)==0);
    printf("FAE_F2_CANONICAL=%s elapsed_s=%.6f\n",canonical_ok?"PASS":"FAIL",sec);
    if(!canonical_ok) {
        printf("canonical_actual="); print_hex(out,160); printf("\n");
        printf("canonical_expect="); print_hex(want,160); printf("\n");
        rc=10; goto out;
    }

    int pass=0;
    double total=0;
    for(int i=0;i<16;i++) {
        put64le(in+32,1200ULL+i);
        memset(out,0,sizeof(out));
        sec=0;
        rc=run_once(ocl,mem,in,out,&sec); if(rc) goto out;
        total+=sec;
        hex2(expected_final[i],want32,32);
        int ok=(memcmp(out+128,want32,32)==0);
        pass+=ok;
        printf("nonce=%d status=%s elapsed_s=%.6f final=",1200+i,ok?"PASS":"FAIL",sec);
        print_hex(out+128,32); printf("\n");
        if(!ok){rc=11;goto out;}
    }
    printf("FAE_F2_16VECTORS=%d/16 total_s=%.6f\n",pass,total);
    rc=(pass==16)?0:1;

out:
    if(mem!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(mem);
    if(ocl!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(ocl);
    printf("FAE_F2_PARITY_EXIT=%d\n",rc);
    return rc;
}
