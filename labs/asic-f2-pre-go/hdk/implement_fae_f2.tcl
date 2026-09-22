# FAE F2 full HLx implementation — Lab only.
# The runner must prepare the AWS HLx environment and place the exported FAE
# HLS IP under $HDK_SHELL_DIR/hlx/design/ip before invoking this script.

set ::env(FAE_CONTINUE_AFTER_VALIDATE) 1
source [file join [file dirname [info script]] integrate_fae_f2.tcl]

puts "FAE_HDK_IMPLEMENTATION_START"

# Regenerate output products after replacing CDMA with FAE.
set bd_files [get_files *.bd]
if {[llength $bd_files] == 0} { error "NO_BD_FOR_IMPLEMENTATION" }
generate_target all [lindex $bd_files 0]

set runs [get_runs]
puts "AVAILABLE_RUNS=$runs"
if {[llength [get_runs impl_1]] == 0} { error "IMPL_1_NOT_FOUND" }

# HLx overrides launch_runs for the FaaS flow. Implementation implicitly
# launches prerequisite synthesis when needed.
launch_runs impl_1 -jobs 12
wait_on_run impl_1

set st [get_property STATUS [get_runs impl_1]]
set prog [get_property PROGRESS [get_runs impl_1]]
puts "IMPL_STATUS=$st"
puts "IMPL_PROGRESS=$prog"

if {$prog ne "100%"} {
  error "IMPLEMENTATION_NOT_100_PERCENT:$st:$prog"
}
if {![string match "*Complete*" $st]} {
  error "IMPLEMENTATION_NOT_COMPLETE:$st"
}

puts "FAE_HDK_IMPLEMENTATION_PASS"
exit
