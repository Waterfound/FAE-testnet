# FAE F2 A3-R4 control repair R3-T1 full HLx implementation — Lab only.
# Frozen C6 DP6 HLS semantics. R3-T1 preserves SmartConnect-internal control CDC and requests local 166.667 MHz.
#
# Authority boundary:
# - one physical implementation build only
# - no AFI creation
# - no F2 runtime / benchmark / attacker sweep / sustained-HFB
# - no release / consensus / economics / activation height / mainnet action
#
# Fail closed unless final routed timing satisfies:
#   WNS >= 0
#   TNS = 0
#   WHS >= 0
#   THS = 0

set ::env(FAE_CONTINUE_AFTER_VALIDATE) 1
source [file join [file dirname [info script]] integrate_fae_f2_2lane_166p667mhz_a3_r4_controlrepair_r3t1.tcl]

puts "FAE_HDK_A3_R4_CONTROL_REPAIR_R3T1_IMPLEMENTATION_START"

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FOR_IMPLEMENTATION" }
generate_target all [lindex $bd_files 0]

if {[llength [get_runs impl_1]] == 0} { error "IMPL_1_NOT_FOUND" }
set impl [get_runs impl_1]

set global_strategy [get_property STRATEGY $impl]
puts "GLOBAL_IMPL_STRATEGY=$global_strategy"
if {$global_strategy ne "Vivado Implementation Defaults"} {
  error "AWS_HLX_GLOBAL_STRATEGY_CHANGED:$global_strategy"
}

puts "BASE_OPT_DIRECTIVE=[get_property STEPS.OPT_DESIGN.ARGS.DIRECTIVE $impl]"
puts "BASE_PLACE_DIRECTIVE=[get_property STEPS.PLACE_DESIGN.ARGS.DIRECTIVE $impl]"
puts "BASE_PHYS_OPT_DIRECTIVE=[get_property STEPS.PHYS_OPT_DESIGN.ARGS.DIRECTIVE $impl]"
puts "BASE_ROUTE_DIRECTIVE=[get_property STEPS.ROUTE_DESIGN.ARGS.DIRECTIVE $impl]"
puts "BASE_POST_ROUTE_PHYS_OPT_ENABLED=[get_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.IS_ENABLED $impl]"
puts "BASE_POST_ROUTE_PHYS_OPT_DIRECTIVE=[get_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.ARGS.DIRECTIVE $impl]"

if {[get_property STRATEGY $impl] ne "Vivado Implementation Defaults"} {
  error "AWS_HLX_GLOBAL_STRATEGY_MUTATED"
}
if {[get_property STEPS.OPT_DESIGN.ARGS.DIRECTIVE $impl] ne "Explore"} {
  error "AWS_HLX_OPT_DIRECTIVE_MUTATED"
}
if {[get_property STEPS.PLACE_DESIGN.ARGS.DIRECTIVE $impl] ne "Explore"} {
  error "AWS_HLX_PLACE_DIRECTIVE_MUTATED"
}

puts "EFFECTIVE_PHYS_OPT_DIRECTIVE=[get_property STEPS.PHYS_OPT_DESIGN.ARGS.DIRECTIVE $impl]"
puts "EFFECTIVE_ROUTE_DIRECTIVE=[get_property STEPS.ROUTE_DESIGN.ARGS.DIRECTIVE $impl]"
puts "EFFECTIVE_POST_ROUTE_PHYS_OPT_ENABLED=[get_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.IS_ENABLED $impl]"
puts "EFFECTIVE_POST_ROUTE_PHYS_OPT_DIRECTIVE=[get_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.ARGS.DIRECTIVE $impl]"

launch_runs impl_1 -jobs 12
wait_on_run impl_1

set st   [get_property STATUS [get_runs impl_1]]
set prog [get_property PROGRESS [get_runs impl_1]]
set wns  [get_property STATS.WNS [get_runs impl_1]]
set tns  [get_property STATS.TNS [get_runs impl_1]]
set whs  [get_property STATS.WHS [get_runs impl_1]]
set ths  [get_property STATS.THS [get_runs impl_1]]

puts "IMPL_STATUS=$st"
puts "IMPL_PROGRESS=$prog"
puts "IMPL_WNS=$wns"
puts "IMPL_TNS=$tns"
puts "IMPL_WHS=$whs"
puts "IMPL_THS=$ths"

if {$prog ne "100%"} { error "IMPLEMENTATION_NOT_100_PERCENT:$st:$prog" }
if {![string match "*Complete*" $st]} { error "IMPLEMENTATION_NOT_COMPLETE:$st" }
if {[string match "*Failed Timing*" $st]} {
  error "IMPLEMENTATION_FAILED_TIMING:$st:WNS=$wns:TNS=$tns:WHS=$whs:THS=$ths"
}
foreach {name value} [list WNS $wns TNS $tns WHS $whs THS $ths] {
  if {$value eq ""} { error "IMPLEMENTATION_MISSING_$name" }
}
if {[expr {double($wns) < 0.0}]} { error "IMPLEMENTATION_NEGATIVE_WNS:$wns" }
if {[expr {double($tns) != 0.0}]} { error "IMPLEMENTATION_NONZERO_TNS:$tns" }
if {[expr {double($whs) < 0.0}]} { error "IMPLEMENTATION_NEGATIVE_WHS:$whs" }
if {[expr {double($ths) != 0.0}]} { error "IMPLEMENTATION_NONZERO_THS:$ths" }

if {[info exists ::env(FAE_EVIDENCE_DIR)]} {
  set edir $::env(FAE_EVIDENCE_DIR)
  file mkdir $edir
  open_run impl_1
  report_utilization -hierarchical -file "$edir/route_utilization_hierarchical.rpt"
  report_timing_summary -file "$edir/route_timing_summary.rpt"
  report_route_status -file "$edir/route_status.rpt"
  report_clock_utilization -file "$edir/clock_utilization.rpt"
}

puts "FAE_HDK_A3_R4_CONTROL_REPAIR_R3T1_TIMING_CLOSED"
puts "FAE_HDK_A3_R4_CONTROL_REPAIR_R3T1_IMPLEMENTATION_PASS"
exit
