# FAE F2 full HLx implementation — Lab only.
# The runner must prepare the AWS HLx environment and place the exported FAE
# HLS IP under $HDK_SHELL_DIR/hlx/design/ip before invoking this script.
#
# Optional timing-closure knobs:
#   FAE_PHYS_OPT_DIRECTIVE=<Vivado phys_opt_design directive>
#   FAE_ROUTE_DIRECTIVE=<Vivado route_design directive>
#   FAE_POST_ROUTE_PHYS_OPT_ENABLE=1
#   FAE_POST_ROUTE_PHYS_OPT_DIRECTIVE=<Vivado post-route phys_opt directive>
#
# IMPORTANT: the AWS HLx global implementation STRATEGY is intentionally left
# untouched. AWS launch hooks depend on the default FaaS run configuration.

set ::env(FAE_CONTINUE_AFTER_VALIDATE) 1
source [file join [file dirname [info script]] integrate_fae_f2.tcl]

puts "FAE_HDK_IMPLEMENTATION_START"

set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FOR_IMPLEMENTATION" }
generate_target all [lindex $bd_files 0]

set runs [get_runs]
puts "AVAILABLE_RUNS=$runs"
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

if {[info exists ::env(FAE_PHYS_OPT_DIRECTIVE)] && $::env(FAE_PHYS_OPT_DIRECTIVE) ne ""} {
  set pd $::env(FAE_PHYS_OPT_DIRECTIVE)
  puts "FAE_PHYS_OPT_DIRECTIVE=$pd"
  set_property STEPS.PHYS_OPT_DESIGN.ARGS.DIRECTIVE $pd $impl
}
if {[info exists ::env(FAE_ROUTE_DIRECTIVE)] && $::env(FAE_ROUTE_DIRECTIVE) ne ""} {
  set rd $::env(FAE_ROUTE_DIRECTIVE)
  puts "FAE_ROUTE_DIRECTIVE=$rd"
  set_property STEPS.ROUTE_DESIGN.ARGS.DIRECTIVE $rd $impl
}
if {[info exists ::env(FAE_POST_ROUTE_PHYS_OPT_ENABLE)] && $::env(FAE_POST_ROUTE_PHYS_OPT_ENABLE) eq "1"} {
  puts "FAE_POST_ROUTE_PHYS_OPT_ENABLE=1"
  set_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.IS_ENABLED true $impl
  if {[info exists ::env(FAE_POST_ROUTE_PHYS_OPT_DIRECTIVE)] && $::env(FAE_POST_ROUTE_PHYS_OPT_DIRECTIVE) ne ""} {
    set prd $::env(FAE_POST_ROUTE_PHYS_OPT_DIRECTIVE)
    puts "FAE_POST_ROUTE_PHYS_OPT_DIRECTIVE=$prd"
    set_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.ARGS.DIRECTIVE $prd $impl
  }
}

# Fail closed if an external change silently altered AWS-sensitive knobs.
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
