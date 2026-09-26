#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>

#include "fpga_pci.h"
#include "fpga_mgmt.h"
#include "fpga_dma.h"

#define REG_AP_CTRL       0x00
#define REG_INPUT_L       0x10
#define REG_INPUT_H       0x14
#define REG_OUTPUT_L      0x1c
#define REG_OUTPUT_H      0x20
#define REG_MATRIX_L      0x28
#define REG_MATRIX_H      0x2c

#define INPUT_ADDR   0x1000000000ULL
#define OUTPUT_ADDR  0x1000001000ULL
#define MATRIX_ADDR  0x0200000000ULL

static int hex2(const char *s, uint8_t *out, size_t n) {
    for (size_t i=0;i<n;i++) {
        unsigned x=0;
        if (sscanf(s+2*i, "%2x", &x) != 1) return -1;
        out[i]=(uint8_t)x;
    }
    return 0;
}
static void put64le(uint8_t *p, uint64_t v) {
    for (int i=0;i<8;i++) p[i]=(uint8_t)(v>>(8*i));
}
static double mono_s(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC,&t);
    return (double)t.tv_sec + (double)t.tv_nsec/1e9;
}
static int poke64(pci_bar_handle_t bar, uint32_t lo_off, uint32_t hi_off, uint64_t v) {
    int rc=fpga_pci_poke(bar,lo_off,(uint32_t)v);
    if (rc) return rc;
    return fpga_pci_poke(bar,hi_off,(uint32_t)(v>>32));
}
static void print_hex(const uint8_t *p,size_t n) {
    for(size_t i=0;i<n;i++) printf("%02x",p[i]);
    printf("\n");
}
static int build_input(uint64_t nonce,uint8_t in[112]) {
    memset(in,0,112);
    if (hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",in,32)) return -1;
    put64le(in+32,nonce);
    if (hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",in+40,32)) return -1;
    if (hex2("1111111111111111111111111111111111111111111111111111111111111111",in+72,32)) return -1;
    put64le(in+104,1001ULL);
    return 0;
}
static int build_canonical_expected(uint8_t out[160]) {
    memset(out,0,160);
    if(hex2("5e863f7a72d0922c9e24583e2e9256104bdb0b390d0d779c84e716487d644211",out,32)) return -1;
    if(hex2("15cc8a8385b855d9a4cc1eea8ffe6b6fe470ea1680e5ade44414d505594662f4",out+32,32)) return -1;
    const uint64_t regs[8]={
      0x0cd21cc5fe20839eULL,0x36c782d357f08ec3ULL,0xc7ead5a8b8904395ULL,0xc15d8a47e6769f64ULL,
      0x1a22ad1cbcd709daULL,0x5824dc868e776b7dULL,0xa50f55a3e2455509ULL,0x385ffd011dd71d15ULL
    };
    for(int i=0;i<8;i++) put64le(out+64+8*i,regs[i]);
    if(hex2("855bb2345c5a6e3c36979ae89cb63a70ab948b077d6590ccf1fb70dff5242c0c",out+128,32)) return -1;
    return 0;
}

int main(int argc,char **argv) {
    if(argc < 3) {
        fprintf(stderr,"usage: %s <nonce> <expected_final_32_hex> [canonical_full]\n",argv[0]);
        return 2;
    }
    uint64_t nonce=strtoull(argv[1],NULL,0);
    uint8_t expected_final[32];
    if(strlen(argv[2])!=64 || hex2(argv[2],expected_final,32)) {
        fprintf(stderr,"bad expected final hash\n"); return 2;
    }
    bool canonical=(argc>=4 && strcmp(argv[3],"canonical_full")==0);
    if(canonical && nonce!=1200ULL) {
        fprintf(stderr,"canonical_full is only valid for nonce 1200\n"); return 2;
    }

    uint8_t input[112], output[160], readback[112];
    if(build_input(nonce,input)) return 2;
    memset(output,0,sizeof(output));
    memset(readback,0,sizeof(readback));

    int rc=fpga_mgmt_init();
    if(rc){fprintf(stderr,"fpga_mgmt_init rc=%d\n",rc);return 3;}

    pci_bar_handle_t bar=PCI_BAR_HANDLE_INIT;
    rc=fpga_pci_attach(0,0,0,0,&bar);
    if(rc){fprintf(stderr,"fpga_pci_attach rc=%d\n",rc);return 4;}

    int wfd=fpga_dma_open_queue(FPGA_DMA_XDMA,0,0,false);
    int rfd=fpga_dma_open_queue(FPGA_DMA_XDMA,0,0,true);
    if(wfd<0 || rfd<0){
        fprintf(stderr,"fpga_dma_open_queue wfd=%d rfd=%d errno=%d\n",wfd,rfd,errno);
        rc=5; goto out;
    }

    rc=fpga_dma_burst_write(wfd,input,sizeof(input),INPUT_ADDR);
    if(rc){fprintf(stderr,"input DMA write rc=%d\n",rc);goto out;}
    rc=fpga_dma_burst_read(rfd,readback,sizeof(readback),INPUT_ADDR);
    if(rc){fprintf(stderr,"input DMA readback rc=%d\n",rc);goto out;}
    if(memcmp(input,readback,sizeof(input))!=0){
        fprintf(stderr,"input DMA readback mismatch\n");rc=6;goto out;
    }
    memset(output,0,sizeof(output));
    rc=fpga_dma_burst_write(wfd,output,sizeof(output),OUTPUT_ADDR);
    if(rc){fprintf(stderr,"output clear DMA rc=%d\n",rc);goto out;}

    if((rc=poke64(bar,REG_INPUT_L,REG_INPUT_H,INPUT_ADDR))) goto out;
    if((rc=poke64(bar,REG_OUTPUT_L,REG_OUTPUT_H,OUTPUT_ADDR))) goto out;
    if((rc=poke64(bar,REG_MATRIX_L,REG_MATRIX_H,MATRIX_ADDR))) goto out;

    uint32_t ctrl=0;
    rc=fpga_pci_peek(bar,REG_AP_CTRL,&ctrl);
    if(rc){fprintf(stderr,"initial ctrl peek rc=%d\n",rc);goto out;}
    printf("FAE_F2_CTRL_BEFORE=0x%08x\n",ctrl);

    double t0=mono_s();
    rc=fpga_pci_poke(bar,REG_AP_CTRL,1u);
    if(rc){fprintf(stderr,"start poke rc=%d\n",rc);goto out;}

    const double timeout_s=1800.0;
    unsigned long polls=0;
    bool done=false;
    for(;;){
        usleep(1000);
        rc=fpga_pci_peek(bar,REG_AP_CTRL,&ctrl);
        if(rc){fprintf(stderr,"poll peek rc=%d\n",rc);goto out;}
        polls++;
        if(ctrl & 0x2u){done=true;break;}
        if((mono_s()-t0)>timeout_s) break;
    }
    double elapsed=mono_s()-t0;
    if(!done){
        fprintf(stderr,"FAE_F2_TIMEOUT nonce=%llu elapsed_s=%.6f ctrl=0x%08x polls=%lu\n",
                (unsigned long long)nonce,elapsed,ctrl,polls);
        rc=7;goto out;
    }

    rc=fpga_dma_burst_read(rfd,output,sizeof(output),OUTPUT_ADDR);
    if(rc){fprintf(stderr,"output DMA read rc=%d\n",rc);goto out;}

    bool final_ok=(memcmp(output+128,expected_final,32)==0);
    bool full_ok=true;
    if(canonical){
        uint8_t want[160];
        if(build_canonical_expected(want)){rc=2;goto out;}
        full_ok=(memcmp(output,want,160)==0);
    }

    printf("FAE_F2_RESULT nonce=%llu elapsed_s=%.6f final=%s full=%s polls=%lu\n",
           (unsigned long long)nonce,elapsed,final_ok?"PASS":"FAIL",
           canonical?(full_ok?"PASS":"FAIL"):"NA",polls);
    if(!final_ok || !full_ok){
        printf("FAE_F2_OUTPUT_HEX=");print_hex(output,160);
        rc=8;goto out;
    }
    rc=0;
out:
    if(wfd>=0) close(wfd);
    if(rfd>=0) close(rfd);
    if(bar!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(bar);
    return rc;
}
