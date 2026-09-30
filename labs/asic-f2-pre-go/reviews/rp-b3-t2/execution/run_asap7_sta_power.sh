#!/usr/bin/env bash
set -euo pipefail

ROOT="$GITHUB_WORKSPACE"
T1="$ROOT/labs/asic-f2-pre-go/reviews/rp-b3-t1"
T2="$ROOT/labs/asic-f2-pre-go/reviews/rp-b3-t2"
WORK="$T2/work"
RESULTS="$T2/results"
EXPECTED="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
ORFS_COMMIT="a12d46907510891a2e3d3310abdd19975d28db0e"
ORFS_IMAGE="openroad/orfs@sha256:9eed01a3dc8030f423af6a3601c172459a4ddf8f76913db5e25febe3e7435d7a"

rm -rf "$WORK" "$RESULTS"
mkdir -p "$WORK/c6_export" "$RESULTS/logs" "$RESULTS/reports"

cat "$T1"/input/c6_export.part*.b64 | tr -d '\r\n\t ' | base64 -d > "$WORK/c6_export.zip"
ACTUAL="$(sha256sum "$WORK/c6_export.zip" | awk '{print $1}')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  printf '{"status":"FAIL_INTEGRITY","expected":"%s","actual":"%s"}\n' "$EXPECTED" "$ACTUAL" > "$RESULTS/EXECUTION_RESULT.json"
  exit 20
fi
unzip -q "$WORK/c6_export.zip" -d "$WORK/c6_export"

python3 - <<'PY'
import json
p="labs/asic-f2-pre-go/reviews/rp-b3-t1/EQUIVALENCE.json"
d=json.load(open(p))
assert d["verdict"]=="PASS_EQUIVALENCE"
assert d["reconstruction"]["reconstructed_sha256"]=="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
PY

git clone -q https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts.git "$WORK/orfs"
git -C "$WORK/orfs" checkout -q "$ORFS_COMMIT"
git -C "$WORK/orfs" submodule update --init --recursive --depth 1 || true
test "$(git -C "$WORK/orfs" rev-parse HEAD)" = "$ORFS_COMMIT"
ASAP7_TREE="$(git -C "$WORK/orfs" rev-parse HEAD:flow/platforms/asap7)"

docker pull "$ORFS_IMAGE" | tee "$RESULTS/logs/docker-pull.txt"
IMAGE_ID="$(docker image inspect "$ORFS_IMAGE" --format '{{.Id}}')"
{
  echo "orfs_commit=$ORFS_COMMIT"
  echo "asap7_tree=$ASAP7_TREE"
  echo "container_ref=$ORFS_IMAGE"
  echo "container_id=$IMAGE_ID"
  docker run --rm "$ORFS_IMAGE" bash -lc 'source ./env.sh >/dev/null 2>&1; yosys -V; openroad -version'
} | tee "$RESULTS/logs/tool-versions.txt"

SRC="$WORK/orfs/flow/designs/src/fae_dp6_rp_b3_t2"
mkdir -p "$SRC"
cp "$WORK/c6_export"/hdl/verilog/*.v "$SRC/"

make_variant() {
  local variant="$1" top="$2"
  local d="$WORK/orfs/flow/designs/asap7/fae_dp6_rp_b3_t2/$variant"
  mkdir -p "$d"
  cat > "$d/config.mk" <<EOF
export PLATFORM = asap7
export DESIGN_NAME = $top
export DESIGN_NICKNAME = $variant
export VERILOG_FILES = \$(sort \$(wildcard \$(DESIGN_HOME)/src/fae_dp6_rp_b3_t2/*.v))
export SDC_FILE = \$(DESIGN_HOME)/\$(PLATFORM)/fae_dp6_rp_b3_t2/$variant/constraint.sdc
export CORE_UTILIZATION = 40
export CORE_ASPECT_RATIO = 1
export CORE_MARGIN = 2
export PLACE_DENSITY = 0.60
export TNS_END_PERCENT = 100
export SYNTH_USE_SYN = 1
export SYNTH_HDL_FRONTEND = slang
EOF
  cat > "$d/constraint.sdc" <<EOF
current_design $top
set clk_period 6.0
set clk_port [get_ports ap_clk]
create_clock -name core_clock -period \$clk_period \$clk_port
set non_clock_inputs [all_inputs -no_clocks]
set_input_delay [expr \$clk_period * 0.10] -clock core_clock \$non_clock_inputs
set_output_delay [expr \$clk_period * 0.10] -clock core_clock [all_outputs]
EOF
}

make_variant full_6ns fae_dp6_hls
make_variant rw5_6ns fae_dp6_hls_rw5
make_variant argon_6ns fae_dp6_hls_argon2d_fixed

run_orfs() {
  local variant="$1" label="$2" targets="$3"
  local cfg="designs/asap7/fae_dp6_rp_b3_t2/$variant/config.mk"
  local log="$RESULTS/logs/$variant-$label.log"
  set +e
  docker run --rm -u "$(id -u):$(id -g)" \
    -v "$WORK/orfs/flow:/OpenROAD-flow-scripts/flow" \
    -w /OpenROAD-flow-scripts \
    "$ORFS_IMAGE" bash -lc "source ./env.sh && cd flow && make DESIGN_CONFIG=$cfg $targets" >"$log" 2>&1
  local rc=$?
  set -e
  echo "$rc" > "$RESULTS/logs/$variant-$label.rc"
}

run_orfs full_6ns synth "clean_all synth"
run_orfs rw5_6ns synth "clean_all synth"
run_orfs argon_6ns synth "clean_all synth"

if [ "$(cat "$RESULTS/logs/full_6ns-synth.rc")" = "0" ]; then
  run_orfs full_6ns place "place"
fi

for variant in full_6ns rw5_6ns argon_6ns; do
  base="$WORK/orfs/flow/reports/asap7/$variant"
  if [ -d "$base" ]; then
    find "$base" -type f | while read -r f; do
      if [ "$(stat -c %s "$f")" -lt 5000000 ]; then
        rel="$(echo "$f" | sed "s#^$WORK/orfs/flow/reports/##")"
        mkdir -p "$RESULTS/reports/$(dirname "$rel")"
        cp "$f" "$RESULTS/reports/$rel"
      fi
    done
  fi
done

python3 - <<PY
import json, os, glob, re, hashlib
res=os.path.join(os.environ["GITHUB_WORKSPACE"],"labs/asic-f2-pre-go/reviews/rp-b3-t2/results")
def rc(v,l):
    p=os.path.join(res,"logs",f"{v}-{l}.rc")
    return int(open(p).read().strip()) if os.path.exists(p) else None
prov={
 "schema":"fae.dp6.rp_b3_t2.tool_provenance.v1",
 "github_run_id":os.environ.get("GITHUB_RUN_ID"),
 "source_revision":os.environ.get("GITHUB_SHA"),
 "c6_sha256":"$ACTUAL",
 "equivalence":"PASS_EQUIVALENCE",
 "orfs_commit":"$ORFS_COMMIT",
 "asap7_tree":"$ASAP7_TREE",
 "container_ref":"$ORFS_IMAGE",
 "container_id":"$IMAGE_ID",
 "frontend":"slang",
 "clock_period_ns":6.0,
 "power_boundary":"ORFS/Liberty statistical activity; no VCD/SAIF; predictive research only",
 "platform_role":"ASAP7 predictive research platform, not production-foundry evidence"
}
open(os.path.join(res,"TOOL_PROVENANCE.json"),"w").write(json.dumps(prov,indent=2)+"\n")
result={
 "schema":"fae.dp6.rp_b3_t2.execution_result.v1",
 "integrity":"PASS",
 "equivalence":"PASS_EQUIVALENCE",
 "stages":{
   "full_6ns_synth_rc":rc("full_6ns","synth"),
   "rw5_6ns_synth_rc":rc("rw5_6ns","synth"),
   "argon_6ns_synth_rc":rc("argon_6ns","synth"),
   "full_6ns_place_rc":rc("full_6ns","place")
 },
 "asic_lab":"HOLD",
 "aws_fpga_used":False,
 "physical_execution":False
}
open(os.path.join(res,"EXECUTION_RESULT.json"),"w").write(json.dumps(result,indent=2)+"\n")
pat=re.compile(r"(report_wns|report_tns|worst slack|critical path|clock min period|fmax|report_power|Total|Internal|Switching|Leakage|Design area|setup violation count|hold violation count)",re.I)
out=[]
for p in glob.glob(os.path.join(res,"reports","**","*"),recursive=True)+glob.glob(os.path.join(res,"logs","*.log")):
  if not os.path.isfile(p): continue
  try:
    for n,line in enumerate(open(p,errors="ignore"),1):
      if pat.search(line):
        out.append(f"{os.path.relpath(p,res)}:{n}:{line.rstrip()}")
  except Exception: pass
open(os.path.join(res,"METRICS_EXTRACT.txt"),"w").write("\n".join(out)+"\n")
PY

for f in "$RESULTS"/logs/*.log; do
  [ -f "$f" ] || continue
  tail -n 1600 "$f" > "$f.tail"
  mv "$f.tail" "$f"
done

rm -rf "$WORK"
