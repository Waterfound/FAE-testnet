# FAE ASIC F2 A2b two-lane 200 MHz local-clock integration — Lab only.
# Reuses the frozen timing-clean C6 HLS IP byte-for-byte.
# F2 shell clk_main_a0 remains 250 MHz. A local MMCM-derived 200 MHz clock
# drives both FAE HLS lanes. All AXI crossings are explicit clock converters.
# No DP6 semantic, consensus, wallet, testnet, or mainnet changes.

create_project -force fae_f2_hlx_2lane_200mhz .

aws::make_ipi -examples cl_ipi_cdma_test

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FILE_GENERATED" }
open_bd_design [lindex $bd_files 0]

if {[llength [get_ipdefs -all xilinx.com:hls:fae_dp6_hls:1.0]] == 0} {
  error "FAE_HLS_IP_NOT_DISCOVERED_IN_AWS_REPO"
}

delete_bd_objs [get_bd_cells axi_cdma_0]

# Frozen C6 compute lanes.
create_bd_cell -type ip -vlnv xilinx.com:hls:fae_dp6_hls:1.0 fae_dp6_hls_0
create_bd_cell -type ip -vlnv xilinx.com:hls:fae_dp6_hls:1.0 fae_dp6_hls_1

# 250 MHz shell-domain control split and memory merge.
create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 fae_ctrl_split
set_property -dict [list CONFIG.NUM_SI {1} CONFIG.NUM_MI {2}] [get_bd_cells fae_ctrl_split]
create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 fae_mem_merge
set_property -dict [list CONFIG.NUM_SI {4} CONFIG.NUM_MI {1}] [get_bd_cells fae_mem_merge]

# Local 200 MHz clock derived from the fixed F2 250 MHz clk_main_a0.
create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 fae_clk_200
set_property -dict [list \
  CONFIG.PRIM_SOURCE {No_buffer} \
  CONFIG.PRIM_IN_FREQ {250.000} \
  CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {200.000} \
  CONFIG.RESET_TYPE {ACTIVE_LOW}] [get_bd_cells fae_clk_200]

# Synchronize reset release into the 200 MHz domain.
create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 fae_reset_200
create_bd_cell -type ip -vlnv xilinx.com:ip:xlconstant:1.1 fae_const0
set_property -dict [list CONFIG.CONST_WIDTH {1} CONFIG.CONST_VAL {0}] [get_bd_cells fae_const0]

# Explicit CDC: two AXI-Lite control paths and four full AXI memory paths.
foreach n {ctrl0 ctrl1 mem00 mem01 mem10 mem11} {
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_clock_converter:2.1 fae_cc_$n
}

# Clock generation / reset.
connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_clk_200/clk_in1]
connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_clk_200/resetn]
connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_reset_200/slowest_sync_clk]
connect_bd_net [get_bd_pins fae_clk_200/locked] [get_bd_pins fae_reset_200/dcm_locked]
connect_bd_net [get_bd_pins fae_const0/dout] [get_bd_pins fae_reset_200/ext_reset_in] [get_bd_pins fae_reset_200/aux_reset_in] [get_bd_pins fae_reset_200/mb_debug_sys_rst]

# Shell-domain fabric clocks/resets.
connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_ctrl_split/aclk] [get_bd_pins fae_mem_merge/aclk]
connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_ctrl_split/aresetn] [get_bd_pins fae_mem_merge/aresetn]

# HLS lanes in local 200 MHz domain.
connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_dp6_hls_0/ap_clk] [get_bd_pins fae_dp6_hls_1/ap_clk]
connect_bd_net [get_bd_pins fae_reset_200/peripheral_aresetn] [get_bd_pins fae_dp6_hls_0/ap_rst_n] [get_bd_pins fae_dp6_hls_1/ap_rst_n]

# Control path: shell 250 MHz -> CDC -> HLS 200 MHz.
connect_bd_intf_net [get_bd_intf_pins f2_inst_axi_periph/M01_AXI] [get_bd_intf_pins fae_ctrl_split/S00_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_ctrl_split/M00_AXI] [get_bd_intf_pins fae_cc_ctrl0/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_ctrl0/M_AXI] [get_bd_intf_pins fae_dp6_hls_0/s_axi_control]
connect_bd_intf_net [get_bd_intf_pins fae_ctrl_split/M01_AXI] [get_bd_intf_pins fae_cc_ctrl1/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_ctrl1/M_AXI] [get_bd_intf_pins fae_dp6_hls_1/s_axi_control]

foreach n {ctrl0 ctrl1} {
  connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_cc_$n/s_axi_aclk]
  connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_cc_$n/s_axi_aresetn]
  connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_cc_$n/m_axi_aclk]
  connect_bd_net [get_bd_pins fae_reset_200/peripheral_aresetn] [get_bd_pins fae_cc_$n/m_axi_aresetn]
}

# Memory path: HLS 200 MHz -> CDC -> shell fabric 250 MHz.
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem0] [get_bd_intf_pins fae_cc_mem00/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem00/M_AXI] [get_bd_intf_pins fae_mem_merge/S00_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem1] [get_bd_intf_pins fae_cc_mem01/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem01/M_AXI] [get_bd_intf_pins fae_mem_merge/S01_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_1/m_axi_gmem0] [get_bd_intf_pins fae_cc_mem10/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem10/M_AXI] [get_bd_intf_pins fae_mem_merge/S02_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_1/m_axi_gmem1] [get_bd_intf_pins fae_cc_mem11/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem11/M_AXI] [get_bd_intf_pins fae_mem_merge/S03_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_mem_merge/M00_AXI] [get_bd_intf_pins axi_smc_cdma/S00_AXI]

foreach n {mem00 mem01 mem10 mem11} {
  connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_cc_$n/s_axi_aclk]
  connect_bd_net [get_bd_pins fae_reset_200/peripheral_aresetn] [get_bd_pins fae_cc_$n/s_axi_aresetn]
  connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_cc_$n/m_axi_aclk]
  connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_cc_$n/m_axi_aresetn]
}

# Control address apertures remain stable.
assign_bd_address -offset 0x00000000 -range 0x00001000 \
  -target_address_space [get_bd_addr_spaces f2_inst/M_AXI_OCL] \
  [get_bd_addr_segs fae_dp6_hls_0/s_axi_control/Reg] -force
assign_bd_address -offset 0x00001000 -range 0x00001000 \
  -target_address_space [get_bd_addr_spaces f2_inst/M_AXI_OCL] \
  [get_bd_addr_segs fae_dp6_hls_1/s_axi_control/Reg] -force

set hbm_offsets {
   0 0x0200000000   1 0x0220000000   2 0x0240000000   3 0x0260000000
   4 0x0280000000   5 0x02A0000000   6 0x02C0000000   7 0x02E0000000
   8 0x0300000000   9 0x0320000000  10 0x0340000000  11 0x0360000000
  12 0x0380000000  13 0x03A0000000  14 0x03C0000000  15 0x03E0000000
}

foreach lane {0 1} {
  foreach ifname {m_axi_gmem0 m_axi_gmem1} {
    set pin [get_bd_intf_pins fae_dp6_hls_${lane}/$ifname]
    set aspaces [get_bd_addr_spaces -of_objects $pin]
    if {[llength $aspaces] != 1} { error "UNEXPECTED_ADDR_SPACE_lane${lane}_$ifname:$aspaces" }
    set as [lindex $aspaces 0]

    assign_bd_address -offset 0x1000000000 -range 0x1000000000 \
      -target_address_space $as [get_bd_addr_segs f2_inst/S_AXI_DDRA/Mem_DDRA] -force

    foreach {idx off} $hbm_offsets {
      set seg [format "hbm_0/SAXI_00_RT_8HI/HBM_MEM%02d" $idx]
      assign_bd_address -offset $off -range 0x20000000 \
        -target_address_space $as [get_bd_addr_segs $seg] -force
    }
  }
}

validate_bd_design
save_bd_design

if {[info exists ::env(FAE_EVIDENCE_DIR)]} {
  set edir $::env(FAE_EVIDENCE_DIR)
  file mkdir $edir

  set fp [open "$edir/fae_cells.txt" w]
  foreach x [lsort [get_bd_cells -hier]] {
    if {[string match "*fae*" $x] || [string match "*axi_smc_cdma*" $x] || [string match "*smartconnect_hbm*" $x]} {
      puts $fp "$x | VLNV=[get_property VLNV $x]"
    }
  }
  close $fp

  set fp [open "$edir/fae_interfaces.txt" w]
  foreach x [lsort [get_bd_intf_pins -hier]] {
    if {[string match "*fae*" $x]} {
      puts $fp "$x | MODE=[get_property MODE $x] | VLNV=[get_property VLNV $x]"
    }
  }
  close $fp

  set fp [open "$edir/fae_address_map.txt" w]
  foreach x [lsort [get_bd_addr_segs -hier]] {
    if {[string match "*fae*" $x] || [string match "*HBM_MEM*" $x] || [string match "*Mem_DDRA*" $x]} {
      puts $fp "$x | OFFSET=[get_property OFFSET $x] | RANGE=[get_property RANGE $x]"
    }
  }
  close $fp
}

puts "FAE_HDK_2LANE_200MHZ_CDC_PATCH_VALIDATE_PASS"
if {![info exists ::env(FAE_CONTINUE_AFTER_VALIDATE)]} {
  exit
}
