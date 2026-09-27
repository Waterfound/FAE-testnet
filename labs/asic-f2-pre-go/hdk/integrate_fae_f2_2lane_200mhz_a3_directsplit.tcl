# FAE ASIC F2 A3 two-lane direct-split integration — Lab only.
# Frozen C6 DP6 HLS semantics. Shell clk_main_a0 remains 250 MHz.
# Each lane runs at local 200 MHz with explicit CDC.
# gmem0 (input/output) routes directly to DDR fabric.
# gmem1 (256 MiB matrix) routes directly to HBM fabric.
# Removes the A2b 4->1 fae_mem_merge and CDMA routing funnel.

create_project -force fae_f2_hlx_2lane_200mhz_a3_directsplit .

aws::make_ipi -examples cl_ipi_cdma_test

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FILE_GENERATED" }
open_bd_design [lindex $bd_files 0]

if {[llength [get_ipdefs -all xilinx.com:hls:fae_dp6_hls:1.0]] == 0} {
  error "FAE_HLS_IP_NOT_DISCOVERED_IN_AWS_REPO"
}

delete_bd_objs [get_bd_cells axi_cdma_0]
delete_bd_objs [get_bd_cells axi_smc_cdma]

set_property -dict [list CONFIG.NUM_SI {3}] [get_bd_cells smartconnect_ddr4]
set_property -dict [list CONFIG.NUM_SI {3}] [get_bd_cells smartconnect_hbm]

create_bd_cell -type ip -vlnv xilinx.com:hls:fae_dp6_hls:1.0 fae_dp6_hls_0
create_bd_cell -type ip -vlnv xilinx.com:hls:fae_dp6_hls:1.0 fae_dp6_hls_1

create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 fae_ctrl_split
set_property -dict [list CONFIG.NUM_SI {1} CONFIG.NUM_MI {2}] [get_bd_cells fae_ctrl_split]

create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 fae_clk_200
set_property -dict [list \
  CONFIG.PRIM_SOURCE {No_buffer} \
  CONFIG.PRIM_IN_FREQ {250.000} \
  CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {200.000} \
  CONFIG.RESET_TYPE {ACTIVE_LOW}] [get_bd_cells fae_clk_200]

create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 fae_reset_200
create_bd_cell -type ip -vlnv xilinx.com:ip:xlconstant:1.1 fae_const0
set_property -dict [list CONFIG.CONST_WIDTH {1} CONFIG.CONST_VAL {0}] [get_bd_cells fae_const0]

foreach n {ctrl0 ctrl1 mem00 mem01 mem10 mem11} {
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_clock_converter:2.1 fae_cc_$n
}

# The HLS control interfaces are AXI4-Lite. Make that protocol explicit on
# their clock converters so Vivado propagates MAX_BURST_LENGTH=1 end-to-end.
# Memory converters intentionally remain full AXI4.
foreach n {ctrl0 ctrl1} {
  set_property -dict [list CONFIG.PROTOCOL {AXI4LITE}] [get_bd_cells fae_cc_$n]
}

connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_clk_200/clk_in1]
connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_clk_200/resetn]
connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_reset_200/slowest_sync_clk]
connect_bd_net [get_bd_pins fae_clk_200/locked] [get_bd_pins fae_reset_200/dcm_locked]
connect_bd_net [get_bd_pins fae_const0/dout] \
  [get_bd_pins fae_reset_200/ext_reset_in] \
  [get_bd_pins fae_reset_200/aux_reset_in] \
  [get_bd_pins fae_reset_200/mb_debug_sys_rst]

connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_ctrl_split/aclk]
connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_ctrl_split/aresetn]

connect_bd_net [get_bd_pins fae_clk_200/clk_out1] \
  [get_bd_pins fae_dp6_hls_0/ap_clk] [get_bd_pins fae_dp6_hls_1/ap_clk]
connect_bd_net [get_bd_pins fae_reset_200/peripheral_aresetn] \
  [get_bd_pins fae_dp6_hls_0/ap_rst_n] [get_bd_pins fae_dp6_hls_1/ap_rst_n]

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

connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem0] [get_bd_intf_pins fae_cc_mem00/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem00/M_AXI] [get_bd_intf_pins smartconnect_ddr4/S01_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem1] [get_bd_intf_pins fae_cc_mem01/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem01/M_AXI] [get_bd_intf_pins smartconnect_hbm/S01_AXI]

connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_1/m_axi_gmem0] [get_bd_intf_pins fae_cc_mem10/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem10/M_AXI] [get_bd_intf_pins smartconnect_ddr4/S02_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_1/m_axi_gmem1] [get_bd_intf_pins fae_cc_mem11/S_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_cc_mem11/M_AXI] [get_bd_intf_pins smartconnect_hbm/S02_AXI]

foreach n {mem00 mem01 mem10 mem11} {
  connect_bd_net [get_bd_pins fae_clk_200/clk_out1] [get_bd_pins fae_cc_$n/s_axi_aclk]
  connect_bd_net [get_bd_pins fae_reset_200/peripheral_aresetn] [get_bd_pins fae_cc_$n/s_axi_aresetn]
  connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_cc_$n/m_axi_aclk]
  connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_cc_$n/m_axi_aresetn]
}

assign_bd_address -offset 0x00000000 -range 0x00001000 \
  -target_address_space [get_bd_addr_spaces f2_inst/M_AXI_OCL] \
  [get_bd_addr_segs fae_dp6_hls_0/s_axi_control/Reg] -force
assign_bd_address -offset 0x00001000 -range 0x00001000 \
  -target_address_space [get_bd_addr_spaces f2_inst/M_AXI_OCL] \
  [get_bd_addr_segs fae_dp6_hls_1/s_axi_control/Reg] -force

foreach lane {0 1} {
  set pin [get_bd_intf_pins fae_dp6_hls_$lane/m_axi_gmem0]
  set aspaces [get_bd_addr_spaces -of_objects $pin]
  if {[llength $aspaces] != 1} { error "A3_GMEM0_ADDRSPACE_lane$lane:$aspaces" }
  set as [lindex $aspaces 0]
  assign_bd_address -offset 0x1000000000 -range 0x1000000000 \
    -target_address_space $as [get_bd_addr_segs f2_inst/S_AXI_DDRA/Mem_DDRA] -force
}

set pin0 [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem1]
set as0s [get_bd_addr_spaces -of_objects $pin0]
if {[llength $as0s] != 1} { error "A3_GMEM1_ADDRSPACE_lane0:$as0s" }
set as0 [lindex $as0s 0]
assign_bd_address -offset 0x0200000000 -range 0x20000000 \
  -target_address_space $as0 [get_bd_addr_segs hbm_0/SAXI_00_RT_8HI/HBM_MEM00] -force

set pin1 [get_bd_intf_pins fae_dp6_hls_1/m_axi_gmem1]
set as1s [get_bd_addr_spaces -of_objects $pin1]
if {[llength $as1s] != 1} { error "A3_GMEM1_ADDRSPACE_lane1:$as1s" }
set as1 [lindex $as1s 0]
assign_bd_address -offset 0x0220000000 -range 0x20000000 \
  -target_address_space $as1 [get_bd_addr_segs hbm_0/SAXI_00_RT_8HI/HBM_MEM01] -force

validate_bd_design
save_bd_design

if {[llength [get_bd_cells -quiet fae_mem_merge]] != 0} { error "A3_UNEXPECTED_FAE_MEM_MERGE" }
if {[llength [get_bd_cells -quiet axi_smc_cdma]] != 0} { error "A3_UNEXPECTED_AXI_SMC_CDMA" }
if {[get_property CONFIG.NUM_SI [get_bd_cells smartconnect_ddr4]] != 3} { error "A3_DDR_NUM_SI_NOT_3" }
if {[get_property CONFIG.NUM_SI [get_bd_cells smartconnect_hbm]] != 3} { error "A3_HBM_NUM_SI_NOT_3" }

if {[info exists ::env(FAE_EVIDENCE_DIR)]} {
  set edir $::env(FAE_EVIDENCE_DIR)
  file mkdir $edir

  set fp [open "$edir/a3_cells.txt" w]
  foreach x [lsort [get_bd_cells -hier]] {
    if {[string match "*fae*" $x] || [string match "*smartconnect_ddr4*" $x] || [string match "*smartconnect_hbm*" $x]} {
      puts $fp "$x | VLNV=[get_property VLNV $x]"
    }
  }
  close $fp

  set fp [open "$edir/a3_interfaces.txt" w]
  foreach x [lsort [get_bd_intf_pins -hier]] {
    if {[string match "*fae*" $x] || [string match "*smartconnect_ddr4/S0*" $x] || [string match "*smartconnect_hbm/S0*" $x]} {
      puts $fp "$x | MODE=[get_property MODE $x] | NET=[get_bd_intf_nets -quiet -of_objects $x]"
    }
  }
  close $fp

  set fp [open "$edir/a3_address_map.txt" w]
  foreach x [lsort [get_bd_addr_segs -hier]] {
    if {[string match "*fae*" $x] || [string match "*HBM_MEM0*" $x] || [string match "*Mem_DDRA*" $x]} {
      puts $fp "$x | OFFSET=[get_property OFFSET $x] | RANGE=[get_property RANGE $x]"
    }
  }
  close $fp
}

puts "FAE_A3_DIRECTSPLIT_VALIDATE_PASS"
if {![info exists ::env(FAE_CONTINUE_AFTER_VALIDATE)]} { exit }
