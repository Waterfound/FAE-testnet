# FAE F2 full HLx implementation — Lab only.
# The runner must prepare the AWS HLx environment and place the exported FAE
# HLS IP under $HDK_SHELL_DIR/hlx/design/ip before invoking this script.
#
# Optional:
#   FAE_IMPL_STRATEGY=<Vivado implementation strategy>
# Default remains Vivado's configured strategy.

set ::env(FAE_CONTINUE_AFTER_VALIDATE) 1
source [file join [file dirname [info script]] integrate_fae_f2.tcl]

puts "FAE_HDK_IMPLEMENTATION_START"

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FOR_IMPLEMENTATION" }
generate_target all [lindex $bd_files 0]

set runs [get_runs]
puts "AVAILABLE_RUNS=$runs"
if {[llength [get_runs impl_1]] == 0} { error "IMPL_1_NOT_FOUND" }

if {[info exists ::env(FAE_IMPL_STRATEGY)] && $::env(FAE_IMPL_STRATEGY) ne ""} {
  set strategy $::env(FAE_IMPL_STRATEGY)
  puts "FAE_IMPL_STRATEGY=$strategy"
  set_property STRATEGY $strategy [get_runs impl_1]
}
puts "EFFECTIVE_IMPL_STRATEGY=[get_property STRATEGY [get_runs impl_1]]"

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

if {$prog ne "100%"} {
  error "IMPLEMENTATION_NOT_100_PERCENT:$st:$prog"
}
if {![string match "*Complete*" $st]} {
  error "IMPLEMENTATION_NOT_COMPLETE:$st"
}
if {[string match "*Failed Timing*" $st]} {
  error "IMPLEMENTATION_FAILED_TIMING:$st:WNS=$wns:TNS=$tns"
}
if {$wns eq ""} {
  error "IMPLEMENTATION_MISSING_WNS"
}
if {[expr {double($wns) < 0.0}]} {
  error "IMPLEMENTATION_NEGATIVE_WNS:$wns"
}

puts "FAE_HDK_TIMING_CLOSED"
puts "FAE_HDK_IMPLEMENTATION_PASS"
exit
