open_project -reset fae_dp6_hls_prj
set_top fae_dp6_hls
add_files fae_dp6_hls.cpp
add_files -tb test_16_vectors.cpp
open_solution -reset sol_vu47p -flow_target vivado
set_part {xcvu47p-fsvh2892-2-e}
create_clock -period 4.000 -name default
config_interface -m_axi_addr64
csim_design
csynth_design
export_design -format ip_catalog
exit
