#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>

#include "fpga_pci.h"
#include "fpga_mgmt.h"
#include "fpga_dma.h"

#define SLOT 0
#define AP_CTRL 0x00
#define INPUT_R 0x10
#define OUTPUT_R 0x1c
#define MATRIX_WORDS 0x28

/* PCIS host DMA map: DDR-A starts at 0.
 * FAE HLS master map: the same DDR-A segment starts at 0x1000000000.
 */
#define HOST_DDR_A_BASE 0x0000000000ULL
#define HLS_DDR_A_BASE  0x1000000000ULL

#define MATRIX_OFF 0x00000000ULL
#define INPUT_OFF  0x20000000ULL
#define OUTPUT_OFF 0x20001000ULL

#define INPUT_BYTES 112
#define OUTPUT_BYTES 160

static const char *expected_final[16] = {
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

static int hex2(const char *s, uint8_t *out, size_t n) {
    for (size_t i=0;i<n;i++) {
        unsigned x;
        if (sscanf(s+2*i, "%2x", &x) != 1) return -1;
        out[i]=(uint8_t)x;
    }
    return 0;
}
static void put64le(uint8_t *p, uint64_t v) {
    for (int i=0;i<8;i++) p[i]=(uint8_t)(v>>(8*i));
}
static int poke_ptr(pci_bar_handle_t bar, uint64_t reg, uint64_t value) {
    int rc=fpga_pci_poke(bar, reg, (uint32_t)value);
    if (rc) return rc;
    return fpga_pci_poke(bar, reg+4, (uint32_t)(value>>32));
}
static double elapsed(const struct timespec *a, const struct timespec *b) {
    return (double)(b->tv_sec-a->tv_sec) + (double)(b->tv_nsec-a->tv_nsec)/1e9;
}
static int wait_done(pci_bar_handle_t bar, double timeout_s) {
    struct timespec a,b;
    clock_gettime(CLOCK_MONOTONIC,&a);
    for (;;) {
        uint32_t ctrl=0;
        int rc=fpga_pci_peek(bar,AP_CTRL,&ctrl);
        if (rc) return rc;
        if (ctrl & 0x2) return 0; /* ap_done, clear-on-read */
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (elapsed(&a,&b) > timeout_s) return -1001;
        usleep(1000);
    }
}
static int canonical_full_check(const uint8_t out[OUTPUT_BYTES]) {
    uint8_t want[32], q[8];
    if (hex2("5e863f7a72d0922c9e24583e2e9256104bdb0b390d0d779c84e716487d644211",want,32)||memcmp(out,want,32)) return -1;
    if (hex2("15cc8a8385b855d9a4cc1eea8ffe6b6fe470ea1680e5ade44414d505594662f4",want,32)||memcmp(out+32,want,32)) return -2;
    const uint64_t regs[8]={0x0cd21cc5fe20839eULL,0x36c782d357f08ec3ULL,0xc7ead5a8b8904395ULL,0xc15d8a47e6769f64ULL,0x1a22ad1cbcd709daULL,0x5824dc868e776b7dULL,0xa50f55a3e2455509ULL,0x385ffd011dd71d15ULL};
    for (int i=0;i<8;i++) { put64le(q,regs[i]); if (memcmp(out+64+8*i,q,8)) return -3-i; }
    if (hex2(expected_final[0],want,32)||memcmp(out+128,want,32)) return -20;
    return 0;
}

int main(void) {
    int rc=0, read_fd=-1, write_fd=-1, pass=0;
    pci_bar_handle_t bar=PCI_BAR_HANDLE_INIT;
    uint8_t input[INPUT_BYTES]={0}, output[OUTPUT_BYTES], want[32], zeros[OUTPUT_BYTES]={0};

    if (hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",input,32)) return 2;
    if (hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",input+40,32)) return 2;
    if (hex2("1111111111111111111111111111111111111111111111111111111111111111",input+72,32)) return 2;
    put64le(input+104,1001ULL);

    if ((rc=fpga_mgmt_init())) { fprintf(stderr,"fpga_mgmt_init rc=%d\n",rc); return 10; }
    if ((rc=fpga_pci_init())) { fprintf(stderr,"fpga_pci_init rc=%d\n",rc); return 11; }
    if ((rc=fpga_pci_attach(SLOT,FPGA_APP_PF,APP_PF_BAR0,0,&bar))) { fprintf(stderr,"attach rc=%d\n",rc); return 12; }

    read_fd=fpga_dma_open_queue(FPGA_DMA_XDMA,SLOT,0,true);
    write_fd=fpga_dma_open_queue(FPGA_DMA_XDMA,SLOT,0,false);
    if (read_fd<0 || write_fd<0) { fprintf(stderr,"dma queue open read=%d write=%d\n",read_fd,write_fd); rc=13; goto out; }

    const uint64_t matrix_ptr=HLS_DDR_A_BASE+MATRIX_OFF;
    const uint64_t input_ptr=HLS_DDR_A_BASE+INPUT_OFF;
    const uint64_t output_ptr=HLS_DDR_A_BASE+OUTPUT_OFF;
    if ((rc=poke_ptr(bar,INPUT_R,input_ptr)) ||
        (rc=poke_ptr(bar,OUTPUT_R,output_ptr)) ||
        (rc=poke_ptr(bar,MATRIX_WORDS,matrix_ptr))) {
        fprintf(stderr,"pointer poke rc=%d\n",rc); rc=14; goto out;
    }

    printf("F2_MAP host_ddr=0x%llx hls_ddr=0x%llx matrix=0x%llx input=0x%llx output=0x%llx\n",
      (unsigned long long)HOST_DDR_A_BASE,(unsigned long long)HLS_DDR_A_BASE,
      (unsigned long long)matrix_ptr,(unsigned long long)input_ptr,(unsigned long long)output_ptr);

    for (int i=0;i<16;i++) {
        put64le(input+32,1200ULL+(uint64_t)i);
        memset(output,0,sizeof(output));
        if ((rc=fpga_dma_burst_write(write_fd,input,sizeof(input),HOST_DDR_A_BASE+INPUT_OFF))) {
            fprintf(stderr,"input DMA write rc=%d nonce=%d\n",rc,1200+i); rc=20; goto out;
        }
        if ((rc=fpga_dma_burst_write(write_fd,zeros,sizeof(zeros),HOST_DDR_A_BASE+OUTPUT_OFF))) {
            fprintf(stderr,"output zero DMA rc=%d nonce=%d\n",rc,1200+i); rc=21; goto out;
        }

        uint32_t ctrl=0;
        if ((rc=fpga_pci_peek(bar,AP_CTRL,&ctrl))) { rc=22; goto out; }
        if (!(ctrl & 0x4)) fprintf(stderr,"WARN pre-start AP_IDLE=0 ctrl=0x%08x nonce=%d\n",ctrl,1200+i);

        struct timespec a,b;
        clock_gettime(CLOCK_MONOTONIC,&a);
        if ((rc=fpga_pci_poke(bar,AP_CTRL,1))) { fprintf(stderr,"ap_start rc=%d\n",rc); rc=23; goto out; }
        rc=wait_done(bar,300.0);
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (rc) { fprintf(stderr,"wait_done rc=%d nonce=%d\n",rc,1200+i); rc=24; goto out; }

        if ((rc=fpga_dma_burst_read(read_fd,output,sizeof(output),HOST_DDR_A_BASE+OUTPUT_OFF))) {
            fprintf(stderr,"output DMA read rc=%d nonce=%d\n",rc,1200+i); rc=25; goto out;
        }

        bool ok=true;
        if (hex2(expected_final[i],want,32) || memcmp(output+128,want,32)) ok=false;
        if (i==0) {
            int cc=canonical_full_check(output);
            printf("FAE_DP6_F2_CANONICAL=%s detail=%d\n",cc==0?"PASS":"FAIL",cc);
            if (cc) ok=false;
        }
        pass += ok ? 1 : 0;
        printf("nonce=%d status=%s elapsed_s=%.6f\n",1200+i,ok?"PASS":"FAIL",elapsed(&a,&b));
        fflush(stdout);
        if (!ok) { rc=30; goto out; }
    }

    printf("FAE_DP6_F2_16VECTORS=%d/16\n",pass);
    rc=(pass==16)?0:31;

out:
    if (bar!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(bar);
    if (read_fd>=0) close(read_fd);
    if (write_fd>=0) close(write_fd);
    printf("FAE_DP6_F2_RUNTIME_PARITY=%s rc=%d\n",rc==0?"PASS":"FAIL",rc);
    return rc;
}
