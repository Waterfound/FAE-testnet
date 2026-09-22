# FAE ASIC F2 HDK integration patch — Lab only
# FAE HLS IP must already be present under the AWS HLx design/ip repository
# before aws::make_ipi runs. Optional FAE_EVIDENCE_DIR captures evidence.

create_project -force fae_f2_hlx .

# aws::make_ipi owns ip_repo_paths. Keeping the FAE IP physically inside
# $HDK_SHELL_DIR/hlx/design/ip lets the official AWS catalog refresh discover
# AWS + FAE together without closing/re-opening the F2 block design.
aws::make_ipi -examples cl_ipi_cdma_test

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FILE_GENERATED" }
open_bd_design [lindex $bd_files 0]

if {[llength [get_ipdefs -all xilinx.com:hls:fae_dp6_hls:1.0]] == 0} {
  error "FAE_HLS_IP_NOT_DISCOVERED_IN_AWS_REPO"
}

# Replace only the CDMA compute engine; preserve AWS OCL/PCIS/DDR/HBM fabric.
delete_bd_objs [get_bd_cells axi_cdma_0]
create_bd_cell -type ip -vlnv xilinx.com:hls:fae_dp6_hls:1.0 fae_dp6_hls_0
create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 fae_mem_merge
set_property -dict [list CONFIG.NUM_SI {2} CONFIG.NUM_MI {1}] [get_bd_cells fae_mem_merge]

connect_bd_intf_net [get_bd_intf_pins f2_inst_axi_periph/M01_AXI] [get_bd_intf_pins fae_dp6_hls_0/s_axi_control]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem0] [get_bd_intf_pins fae_mem_merge/S00_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_dp6_hls_0/m_axi_gmem1] [get_bd_intf_pins fae_mem_merge/S01_AXI]
connect_bd_intf_net [get_bd_intf_pins fae_mem_merge/M00_AXI] [get_bd_intf_pins axi_smc_cdma/S00_AXI]

connect_bd_net [get_bd_pins f2_inst/clk_main_a0_out] [get_bd_pins fae_dp6_hls_0/ap_clk] [get_bd_pins fae_mem_merge/aclk]
connect_bd_net [get_bd_pins proc_sys_reset_a0/peripheral_aresetn] [get_bd_pins fae_dp6_hls_0/ap_rst_n] [get_bd_pins fae_mem_merge/aresetn]

assign_bd_address -offset 0x00000000 -range 0x00001000 \
  -target_address_space [get_bd_addr_spaces f2_inst/M_AXI_OCL] \
  [get_bd_addr_segs fae_dp6_hls_0/s_axi_control/Reg] -force

set hbm_offsets {
   0 0x0200000000   1 0x0220000000   2 0x0240000000   3 0x0260000000
   4 0x0280000000   5 0x02A0000000   6 0x02C0000000   7 0x02E0000000
   8 0x0300000000   9 0x0320000000  10 0x0340000000  11 0x0360000000
  12 0x0380000000  13 0x03A0000000  14 0x03C0000000  15 0x03E0000000
}
foreach ifname {m_axi_gmem0 m_axi_gmem1} {
  set aspaces [get_bd_addr_spaces -of_objects [get_bd_intf_pins fae_dp6_hls_0/$ifname]]
  if {[llength $aspaces] != 1} { error "UNEXPECTED_ADDR_SPACE_$ifname:$aspaces" }
  set as [lindex $aspaces 0]

  assign_bd_address -offset 0x1000000000 -range 0x1000000000 \
    -target_address_space $as [get_bd_addr_segs f2_inst/S_AXI_DDRA/Mem_DDRA] -force

  foreach {idx off} $hbm_offsets {
    set seg [format "hbm_0/SAXI_00_RT_8HI/HBM_MEM%02d" $idx]
    assign_bd_address -offset $off -range 0x20000000 \
      -target_address_space $as [get_bd_addr_segs $seg] -force
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

puts "FAE_HDK_PATCH_VALIDATE_PASS"
if {![info exists ::env(FAE_CONTINUE_AFTER_VALIDATE)]} {
  exit
}
