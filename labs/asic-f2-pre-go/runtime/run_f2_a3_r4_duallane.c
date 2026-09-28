#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>

#include "fpga_pci.h"
#include "fpga_mgmt.h"

#define SLOT 0
#define AP_CTRL 0x00
#define INPUT_R 0x10
#define OUTPUT_R 0x1c
#define MATRIX_WORDS 0x28
#define CLOCK_BASE_RESET 0x00058014
#define CALIB_STATUS 0x00010000

#define CTRL0_BASE 0x00000000ULL
#define CTRL1_BASE 0x00001000ULL
#define HOST_DDR_A_BASE 0x1000000000ULL
#define HLS_DDR_A_BASE  0x1000000000ULL
#define HBM0_BASE       0x0200000000ULL
#define HBM1_BASE       0x0220000000ULL

#define L0_INPUT_OFF  0x20000000ULL
#define L0_OUTPUT_OFF 0x20001000ULL
#define L1_INPUT_OFF  0x20002000ULL
#define L1_OUTPUT_OFF 0x20003000ULL

#define INPUT_BYTES 112
#define OUTPUT_BYTES 160
#define NVECS 16
#define NBENCH 16

static const char *expected_final[NVECS] = {
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
        unsigned x=0;
        if (sscanf(s+2*i, "%2x", &x) != 1) return -1;
        out[i]=(uint8_t)x;
    }
    return 0;
}
static void put64le(uint8_t *p, uint64_t v) {
    for (int i=0;i<8;i++) p[i]=(uint8_t)(v>>(8*i));
}
static double elapsed(const struct timespec *a, const struct timespec *b) {
    return (double)(b->tv_sec-a->tv_sec) + (double)(b->tv_nsec-a->tv_nsec)/1e9;
}
static int poke_ptr(pci_bar_handle_t bar, uint64_t base, uint64_t reg, uint64_t value) {
    int rc=fpga_pci_poke(bar,base+reg,(uint32_t)value);
    if (rc) return rc;
    return fpga_pci_poke(bar,base+reg+4,(uint32_t)(value>>32));
}
static int peek_ctrl(pci_bar_handle_t bar, uint64_t base, uint32_t *v) {
    return fpga_pci_peek(bar,base+AP_CTRL,v);
}
static int start_lane(pci_bar_handle_t bar, uint64_t base) {
    return fpga_pci_poke(bar,base+AP_CTRL,1u);
}
static int wait_done(pci_bar_handle_t bar, uint64_t base, double timeout_s) {
    struct timespec a,b;
    clock_gettime(CLOCK_MONOTONIC,&a);
    for (;;) {
        uint32_t ctrl=0;
        int rc=peek_ctrl(bar,base,&ctrl);
        if (rc) return rc;
        if (ctrl & 0x2u) return 0;
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (elapsed(&a,&b)>timeout_s) return -1001;
        usleep(1000);
    }
}
static int wait_both(pci_bar_handle_t bar, double timeout_s) {
    struct timespec a,b;
    bool d0=false,d1=false;
    clock_gettime(CLOCK_MONOTONIC,&a);
    for (;;) {
        uint32_t c0=0,c1=0;
        int rc=0;
        if (!d0 && (rc=peek_ctrl(bar,CTRL0_BASE,&c0))) return rc;
        if (!d1 && (rc=peek_ctrl(bar,CTRL1_BASE,&c1))) return rc;
        d0 = d0 || ((c0 & 0x2u)!=0);
        d1 = d1 || ((c1 & 0x2u)!=0);
        if (d0 && d1) return 0;
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (elapsed(&a,&b)>timeout_s) return -1002;
        usleep(1000);
    }
}
static int bar4_write(pci_bar_handle_t bar, uint64_t off, const void *buf, size_t n) {
    if ((off & 3) || (n & 3)) return -1;
    const uint8_t *p=(const uint8_t*)buf;
    for (size_t i=0;i<n;i+=4) {
        uint32_t v;
        memcpy(&v,p+i,4);
        int rc=fpga_pci_poke(bar,off+i,v);
        if (rc) return rc;
    }
    return 0;
}
static int bar4_read(pci_bar_handle_t bar, uint64_t off, void *buf, size_t n) {
    if ((off & 3) || (n & 3)) return -1;
    uint8_t *p=(uint8_t*)buf;
    for (size_t i=0;i<n;i+=4) {
        uint32_t v=0;
        int rc=fpga_pci_peek(bar,off+i,&v);
        if (rc) return rc;
        memcpy(p+i,&v,4);
    }
    return 0;
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
static void init_input(uint8_t input[INPUT_BYTES]) {
    memset(input,0,INPUT_BYTES);
    hex2("83e1528c63f3fad31188c5e266aaf33c5f560c84b1a19b5e68b6ffd7b7bf0da7",input,32);
    hex2("d54aeba77470ebde700d3a0a862d839006339587194e2f054f2ce666c4610a10",input+40,32);
    hex2("1111111111111111111111111111111111111111111111111111111111111111",input+72,32);
    put64le(input+104,1001ULL);
}
static bool final_ok(const uint8_t out[OUTPUT_BYTES], int idx) {
    uint8_t want[32];
    return hex2(expected_final[idx],want,32)==0 && memcmp(out+128,want,32)==0;
}
static int run_lane_vectors(pci_bar_handle_t ocl, pci_bar_handle_t pcis, int lane,
                            uint64_t ctrl_base, uint64_t input_off, uint64_t output_off,
                            double *sum_s) {
    uint8_t input[INPUT_BYTES], output[OUTPUT_BYTES], readback[INPUT_BYTES], zeros[OUTPUT_BYTES]={0};
    init_input(input);
    int pass=0;
    *sum_s=0.0;
    for (int i=0;i<NVECS;i++) {
        put64le(input+32,1200ULL+(uint64_t)i);
        memset(output,0,sizeof(output)); memset(readback,0,sizeof(readback));
        int rc=bar4_write(pcis,HOST_DDR_A_BASE+input_off,input,sizeof(input));
        if (rc) return 100+rc;
        rc=bar4_read(pcis,HOST_DDR_A_BASE+input_off,readback,sizeof(readback));
        if (rc || memcmp(input,readback,sizeof(input))) return 120+(rc?rc:1);
        rc=bar4_write(pcis,HOST_DDR_A_BASE+output_off,zeros,sizeof(zeros));
        if (rc) return 140+rc;

        uint32_t ctrl=0;
        rc=peek_ctrl(ocl,ctrl_base,&ctrl);
        if (rc) return 160+rc;
        if (!(ctrl & 0x4u)) fprintf(stderr,"WARN lane=%d pre-start AP_IDLE=0 ctrl=0x%08x nonce=%d\n",lane,ctrl,1200+i);

        struct timespec a,b;
        clock_gettime(CLOCK_MONOTONIC,&a);
        rc=start_lane(ocl,ctrl_base);
        if (rc) return 180+rc;
        rc=wait_done(ocl,ctrl_base,300.0);
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (rc) return 200+rc;
        double sec=elapsed(&a,&b); *sum_s+=sec;

        __sync_synchronize();
        rc=bar4_read(pcis,HOST_DDR_A_BASE+output_off,output,sizeof(output));
        if (rc) return 220+rc;
        bool ok=final_ok(output,i);
        if (i==0) {
            int cc=canonical_full_check(output);
            printf("FAE_DP6_F2_LANE%d_CANONICAL=%s detail=%d\n",lane,cc==0?"PASS":"FAIL",cc);
            if (cc) ok=false;
        }
        printf("lane=%d nonce=%d status=%s elapsed_s=%.6f\n",lane,1200+i,ok?"PASS":"FAIL",sec);
        fflush(stdout);
        if (!ok) return 240+i;
        pass++;
    }
    printf("FAE_DP6_F2_LANE%d_16VECTORS=%d/16\n",lane,pass);
    return pass==NVECS?0:260;
}

int main(void) {
    int rc=0;
    pci_bar_handle_t ocl=PCI_BAR_HANDLE_INIT,pcis=PCI_BAR_HANDLE_INIT,sda=PCI_BAR_HANDLE_INIT;
    uint8_t input0[INPUT_BYTES],input1[INPUT_BYTES],out0[OUTPUT_BYTES],out1[OUTPUT_BYTES],zeros[OUTPUT_BYTES]={0};
    init_input(input0); init_input(input1);

    if ((rc=fpga_mgmt_init())) return 10;
    if ((rc=fpga_pci_init())) return 11;
    if ((rc=fpga_pci_attach(SLOT,FPGA_APP_PF,APP_PF_BAR0,0,&ocl))) return 12;
    if ((rc=fpga_pci_attach(SLOT,FPGA_APP_PF,APP_PF_BAR4,0,&pcis))) { rc=13; goto out; }
    if ((rc=fpga_pci_attach(SLOT,FPGA_MGMT_PF,MGMT_PF_BAR4,0,&sda))) { rc=14; goto out; }
    if ((rc=fpga_pci_poke(sda,CLOCK_BASE_RESET,0u))) { rc=15; goto out; }

    struct timespec ca,cb; clock_gettime(CLOCK_MONOTONIC,&ca);
    for (;;) {
        uint32_t calib=0;
        rc=fpga_pci_peek(ocl,CALIB_STATUS,&calib);
        if (rc) { rc=16; goto out; }
        if (calib==0x3u) { printf("F2_DDR_HBM_CALIBRATION=PASS value=0x%08x\n",calib); break; }
        clock_gettime(CLOCK_MONOTONIC,&cb);
        if (elapsed(&ca,&cb)>120.0) { rc=17; goto out; }
        usleep(10000);
    }

    const uint64_t l0_input=HLS_DDR_A_BASE+L0_INPUT_OFF, l0_output=HLS_DDR_A_BASE+L0_OUTPUT_OFF;
    const uint64_t l1_input=HLS_DDR_A_BASE+L1_INPUT_OFF, l1_output=HLS_DDR_A_BASE+L1_OUTPUT_OFF;
    if ((rc=poke_ptr(ocl,CTRL0_BASE,INPUT_R,l0_input)) ||
        (rc=poke_ptr(ocl,CTRL0_BASE,OUTPUT_R,l0_output)) ||
        (rc=poke_ptr(ocl,CTRL0_BASE,MATRIX_WORDS,HBM0_BASE)) ||
        (rc=poke_ptr(ocl,CTRL1_BASE,INPUT_R,l1_input)) ||
        (rc=poke_ptr(ocl,CTRL1_BASE,OUTPUT_R,l1_output)) ||
        (rc=poke_ptr(ocl,CTRL1_BASE,MATRIX_WORDS,HBM1_BASE))) {
        rc=18; goto out;
    }
    printf("A3_R4_MAP lane0_ctrl=0x%llx lane0_matrix=0x%llx lane0_input=0x%llx lane0_output=0x%llx lane1_ctrl=0x%llx lane1_matrix=0x%llx lane1_input=0x%llx lane1_output=0x%llx\n",
      (unsigned long long)CTRL0_BASE,(unsigned long long)HBM0_BASE,(unsigned long long)l0_input,(unsigned long long)l0_output,
      (unsigned long long)CTRL1_BASE,(unsigned long long)HBM1_BASE,(unsigned long long)l1_input,(unsigned long long)l1_output);

    double l0sum=0,l1sum=0;
    rc=run_lane_vectors(ocl,pcis,0,CTRL0_BASE,L0_INPUT_OFF,L0_OUTPUT_OFF,&l0sum);
    if (rc) { fprintf(stderr,"lane0 parity rc=%d\n",rc); goto out; }
    rc=run_lane_vectors(ocl,pcis,1,CTRL1_BASE,L1_INPUT_OFF,L1_OUTPUT_OFF,&l1sum);
    if (rc) { fprintf(stderr,"lane1 parity rc=%d\n",rc); goto out; }
    printf("FAE_DP6_F2_DUALLANE_PARITY=PASS lane0_mean_s=%.9f lane1_mean_s=%.9f\n",l0sum/NVECS,l1sum/NVECS);

    double bench_sum=0.0, bench_min=1e99, bench_max=0.0;
    for (int i=0;i<NBENCH;i++) {
        put64le(input0+32,1200ULL+(uint64_t)i);
        put64le(input1+32,1200ULL+(uint64_t)i);
        memset(out0,0,sizeof(out0)); memset(out1,0,sizeof(out1));
        if ((rc=bar4_write(pcis,HOST_DDR_A_BASE+L0_INPUT_OFF,input0,sizeof(input0))) ||
            (rc=bar4_write(pcis,HOST_DDR_A_BASE+L1_INPUT_OFF,input1,sizeof(input1))) ||
            (rc=bar4_write(pcis,HOST_DDR_A_BASE+L0_OUTPUT_OFF,zeros,sizeof(zeros))) ||
            (rc=bar4_write(pcis,HOST_DDR_A_BASE+L1_OUTPUT_OFF,zeros,sizeof(zeros)))) { rc=300+rc; goto out; }

        struct timespec a,b;
        clock_gettime(CLOCK_MONOTONIC,&a);
        if ((rc=start_lane(ocl,CTRL0_BASE))) { rc=320+rc; goto out; }
        if ((rc=start_lane(ocl,CTRL1_BASE))) { rc=340+rc; goto out; }
        rc=wait_both(ocl,300.0);
        clock_gettime(CLOCK_MONOTONIC,&b);
        if (rc) { rc=360+rc; goto out; }
        double sec=elapsed(&a,&b);
        bench_sum+=sec; if (sec<bench_min) bench_min=sec; if (sec>bench_max) bench_max=sec;

        __sync_synchronize();
        if ((rc=bar4_read(pcis,HOST_DDR_A_BASE+L0_OUTPUT_OFF,out0,sizeof(out0))) ||
            (rc=bar4_read(pcis,HOST_DDR_A_BASE+L1_OUTPUT_OFF,out1,sizeof(out1)))) { rc=380+rc; goto out; }
        bool ok0=final_ok(out0,i), ok1=final_ok(out1,i);
        printf("pair=%d nonce=%d lane0=%s lane1=%s elapsed_s=%.6f aggregate_work_s=%.9f\n",
          i,1200+i,ok0?"PASS":"FAIL",ok1?"PASS":"FAIL",sec,2.0/sec);
        fflush(stdout);
        if (!ok0 || !ok1) { rc=400+i; goto out; }
    }

    {
        double mean=bench_sum/NBENCH;
        double agg=(2.0*NBENCH)/bench_sum;
        const double a1=0.05141404101;
        double uplift=(agg/a1-1.0)*100.0;
        printf("FAE_DP6_F2_DUALLANE_BENCH=PASS pairs=%d mean_pair_s=%.9f min_pair_s=%.9f max_pair_s=%.9f aggregate_work_s=%.12f a1_work_s=%.11f uplift_pct=%.9f\n",
          NBENCH,mean,bench_min,bench_max,agg,a1,uplift);
        printf("FAE_DP6_F2_DUALLANE_PROMOTION=%s\n",agg>a1?"FASTER_THAN_A1":"NOT_FASTER_THAN_A1");
        rc=(agg>a1)?0:450;
    }

out:
    if (sda!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(sda);
    if (pcis!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(pcis);
    if (ocl!=PCI_BAR_HANDLE_INIT) fpga_pci_detach(ocl);
    printf("FAE_DP6_F2_A3_R4_RUNTIME=%s rc=%d\n",rc==0?"PASS":"FAIL",rc);
    return rc;
}
