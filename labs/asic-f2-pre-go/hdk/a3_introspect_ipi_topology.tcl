# A3 read-only IPI topology introspection. No implementation.
create_project -force fae_a3_ipi_introspect .
aws::make_ipi -examples cl_ipi_cdma_test

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FILE_GENERATED" }
open_bd_design [lindex $bd_files 0]

if {![info exists ::env(FAE_EVIDENCE_DIR)]} { error "FAE_EVIDENCE_DIR_REQUIRED" }
set edir $::env(FAE_EVIDENCE_DIR)
file mkdir $edir

set fp [open "$edir/all_cells.txt" w]
foreach c [lsort [get_bd_cells -hier]] {
  puts $fp "$c | VLNV=[get_property VLNV $c]"
}
close $fp

set fp [open "$edir/target_properties.txt" w]
foreach c {axi_smc_cdma smartconnect_hbm f2_inst hbm_0} {
  set obj [get_bd_cells -quiet $c]
  if {[llength $obj] == 1} {
    puts $fp "=== $c ==="
    foreach p [lsort [list_property $obj]] {
      set v [get_property $p $obj]
      if {[string match "CONFIG.*" $p] || [string match "*NUM_*" $p] || [string match "*CLOCK*" $p] || [string match "*FREQ*" $p]} {
        puts $fp "$p=$v"
      }
    }
  }
}
close $fp

set fp [open "$edir/target_interfaces.txt" w]
foreach pattern {/axi_smc_cdma/* /smartconnect_hbm/* /f2_inst/* /hbm_0/*} {
  foreach p [lsort [get_bd_intf_pins -quiet $pattern]] {
    set mode [get_property MODE $p]
    set vlnv [get_property VLNV $p]
    set net [get_bd_intf_nets -quiet -of_objects $p]
    puts $fp "$p | MODE=$mode | VLNV=$vlnv | NET=$net"
  }
}
close $fp

set fp [open "$edir/target_pin_clocks.txt" w]
foreach pattern {/axi_smc_cdma/* /smartconnect_hbm/* /f2_inst/* /hbm_0/*} {
  foreach p [lsort [get_bd_pins -quiet $pattern]] {
    set type [get_property TYPE $p]
    set net [get_bd_nets -quiet -of_objects $p]
    if {$type eq "clk" || $type eq "rst"} {
      puts $fp "$p | TYPE=$type | NET=$net"
    }
  }
}
close $fp

set fp [open "$edir/address_spaces.txt" w]
foreach a [lsort [get_bd_addr_spaces -hier]] {
  puts $fp "$a"
}
close $fp

set fp [open "$edir/address_segs.txt" w]
foreach s [lsort [get_bd_addr_segs -hier]] {
  puts $fp "$s | OFFSET=[get_property OFFSET $s] | RANGE=[get_property RANGE $s]"
}
close $fp

validate_bd_design
save_bd_design
puts "FAE_A3_IPI_INTROSPECTION_PASS"
exit 0
