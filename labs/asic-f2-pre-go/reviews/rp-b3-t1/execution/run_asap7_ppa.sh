#!/usr/bin/env bash
set -u -o pipefail

ROOT="$GITHUB_WORKSPACE"
RUN_DIR="$ROOT/labs/asic-f2-pre-go/reviews/rp-b3-t1"
WORK="$RUN_DIR/work"
RESULTS="$RUN_DIR/results"
EXPECTED="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
ORFS_COMMIT="a12d46907510891a2e3d3310abdd19975d28db0e"

rm -rf "$WORK" "$RESULTS"
mkdir -p "$WORK/c6_export" "$RESULTS/logs" "$RESULTS/reports"

cat "$RUN_DIR"/input/c6_export.part*.b64 | tr -d '\r\n\t ' | base64 -d > "$WORK/c6_export.zip"
ACTUAL="$(sha256sum "$WORK/c6_export.zip" | awk '{print $1}')"
BYTES="$(stat -c %s "$WORK/c6_export.zip")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  printf '{"schema":"fae.dp6.rp_b3_t1.execution_result.v1","status":"FAIL_INTEGRITY","expected":"%s","actual":"%s"}\n' "$EXPECTED" "$ACTUAL" > "$RESULTS/EXECUTION_RESULT.json"
  exit 20
fi

unzip -q "$WORK/c6_export.zip" -d "$WORK/c6_export"
test -f "$WORK/c6_export/hdl/verilog/fae_dp6_hls.v"
test -f "$WORK/c6_export/hdl/verilog/fae_dp6_hls_rw5.v"
test -f "$WORK/c6_export/hdl/verilog/fae_dp6_hls_argon2d_fixed.v"

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
ORFS_HEAD="$(git -C "$WORK/orfs" rev-parse HEAD)"
ASAP7_TREE="$(git -C "$WORK/orfs" rev-parse HEAD:flow/platforms/asap7)"
if [ "$ORFS_HEAD" != "$ORFS_COMMIT" ]; then
  echo "ORFS pin mismatch" >&2
  exit 21
fi

docker pull openroad/orfs:latest | tee "$RESULTS/logs/docker-pull.txt"
IMAGE_ID="$(docker image inspect openroad/orfs:latest --format '{{.Id}}')"
IMAGE_DIGEST="$(docker image inspect openroad/orfs:latest --format '{{join .RepoDigests "\n"}}' | head -1)"
{
  echo "orfs_commit=$ORFS_HEAD"
  echo "asap7_tree=$ASAP7_TREE"
  echo "container_id=$IMAGE_ID"
  echo "container_digest=$IMAGE_DIGEST"
  docker run --rm openroad/orfs:latest bash -lc 'source ./env.sh >/dev/null 2>&1; yosys -V; openroad -version'
} | tee "$RESULTS/logs/tool-versions.txt"

SRC="$WORK/orfs/flow/designs/src/fae_dp6_rp_b3_t1"
mkdir -p "$SRC"
cp "$WORK/c6_export"/hdl/verilog/*.v "$SRC/"
VERILOG_COUNT="$(find "$SRC" -name '*.v' | wc -l)"
ASAP7_CONTENT_SHA="$(find "$WORK/orfs/flow/platforms/asap7" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"

make_variant() {
  local variant="$1" top="$2" period="$3"
  local d="$WORK/orfs/flow/designs/asap7/fae_dp6_rp_b3_t1/$variant"
  mkdir -p "$d"
  cat > "$d/config.mk" <<EOF
export PLATFORM = asap7
export DESIGN_NAME = $top
export DESIGN_NICKNAME = $variant
export VERILOG_FILES = \$(sort \$(wildcard \$(DESIGN_HOME)/src/fae_dp6_rp_b3_t1/*.v))
export SDC_FILE = \$(DESIGN_HOME)/\$(PLATFORM)/fae_dp6_rp_b3_t1/$variant/constraint.sdc
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
set clk_period $period
set clk_port [get_ports ap_clk]
create_clock -name core_clock -period \$clk_period \$clk_port
set non_clock_inputs [remove_from_collection [all_inputs] \$clk_port]
set_input_delay [expr \$clk_period * 0.10] -clock core_clock \$non_clock_inputs
set_output_delay [expr \$clk_period * 0.10] -clock core_clock [all_outputs]
EOF
}

make_variant full_2ns fae_dp6_hls 2.0
make_variant full_1ns fae_dp6_hls 1.0
make_variant rw5_2ns fae_dp6_hls_rw5 2.0
make_variant argon_2ns fae_dp6_hls_argon2d_fixed 2.0

run_orfs() {
  local variant="$1" label="$2" targets="$3"
  local cfg="designs/asap7/fae_dp6_rp_b3_t1/$variant/config.mk"
  local log="$RESULTS/logs/$variant-$label.log"
  set +e
  docker run --rm -u "$(id -u):$(id -g)" \
    -v "$WORK/orfs/flow:/OpenROAD-flow-scripts/flow" \
    -w /OpenROAD-flow-scripts \
    openroad/orfs:latest bash -lc "source ./env.sh && cd flow && make DESIGN_CONFIG=$cfg $targets" >"$log" 2>&1
  local rc=$?
  set -e
  echo "$rc" > "$RESULTS/logs/$variant-$label.rc"
}

set -e
run_orfs full_2ns synth "clean_all synth"
run_orfs rw5_2ns synth "clean_all synth"
run_orfs argon_2ns synth "clean_all synth"
run_orfs full_1ns synth "clean_all synth"

if [ "$(cat "$RESULTS/logs/full_2ns-synth.rc")" = "0" ]; then
  run_orfs full_2ns route ""
fi
if [ "$(cat "$RESULTS/logs/full_1ns-synth.rc")" = "0" ]; then
  run_orfs full_1ns place "place"
fi

for variant in full_2ns full_1ns rw5_2ns argon_2ns; do
  find "$WORK/orfs/flow/reports/asap7/$variant" -type f 2>/dev/null | while read -r f; do
    b="$(basename "$f")"
    case "$b" in
      *stat*|*area*|*timing*|*power*|*final*|*metric*|*.json)
        if [ "$(stat -c %s "$f")" -lt 3000000 ]; then
          rel="$(echo "$f" | sed "s#^$WORK/orfs/flow/reports/##")"
          mkdir -p "$RESULTS/reports/$(dirname "$rel")"
          cp "$f" "$RESULTS/reports/$rel"
        fi
        ;;
    esac
  done
done

python3 - <<PY
import json, os, glob, re
root=os.environ["GITHUB_WORKSPACE"]
run_dir=os.path.join(root,"labs/asic-f2-pre-go/reviews/rp-b3-t1")
res=os.path.join(run_dir,"results")
def rc(variant,label):
    p=os.path.join(res,"logs",f"{variant}-{label}.rc")
    return int(open(p).read().strip()) if os.path.exists(p) else None
tool=open(os.path.join(res,"logs","tool-versions.txt")).read()
prov={
  "schema":"fae.dp6.rp_b3_t1.tool_provenance.v1",
  "run_id":"fae-dp6-rp-b3-t1-asap7-001",
  "logical_attempt":2,
  "recovery_of_failed_run_id":36654718186,
  "source_revision":os.environ.get("GITHUB_SHA"),
  "synth_hdl_frontend":"slang",
  "executor":{"provider":"github-actions","run_id":os.environ.get("GITHUB_RUN_ID"),"run_attempt":os.environ.get("GITHUB_RUN_ATTEMPT"),"runner_os":os.environ.get("RUNNER_OS"),"runner_arch":os.environ.get("RUNNER_ARCH")},
  "orfs_commit":"$ORFS_HEAD",
  "asap7_tree":"$ASAP7_TREE",
  "asap7_content_sha256":"$ASAP7_CONTENT_SHA",
  "container_image_id":"$IMAGE_ID",
  "container_repo_digest":"$IMAGE_DIGEST",
  "tool_version_output":tool,
  "platform":{"name":"ASAP7","role":"technology-calibrated predictive research platform; not production-foundry evidence","process_nm_predictive":7,"library_model":"NLDM","vt":"RVT","BC":{"temperature_C":25,"voltage_V":0.77},"TC":{"temperature_C":0,"voltage_V":0.70},"WC":{"temperature_C":100,"voltage_V":0.63}},
  "constraints":{"full_2ns_ns":2.0,"full_1ns_ns":1.0,"rw5_2ns_ns":2.0,"argon_2ns_ns":2.0,"core_utilization_percent":40,"place_density":0.60},
  "power_assumption":"OpenROAD/Liberty statistical activity unless explicit VCD/SAIF is present; predictive estimate only",
  "reconstructed_export_sha256":"$ACTUAL",
  "reconstructed_export_bytes":int("$BYTES"),
  "verilog_file_count":int("$VERILOG_COUNT")
}
open(os.path.join(res,"TOOL_PROVENANCE.json"),"w").write(json.dumps(prov,indent=2)+"\n")
status={
  "schema":"fae.dp6.rp_b3_t1.execution_result.v1",
  "run_id":"fae-dp6-rp-b3-t1-asap7-001",
  "logical_attempt":2,
  "recovery_of_failed_run_id":36654718186,
  "source_revision":os.environ.get("GITHUB_SHA"),
  "synth_hdl_frontend":"slang",
  "integrity":"PASS",
  "equivalence":"PASS_EQUIVALENCE",
  "stages":{
    "full_2ns_synth_rc":rc("full_2ns","synth"),
    "rw5_2ns_synth_rc":rc("rw5_2ns","synth"),
    "argon_2ns_synth_rc":rc("argon_2ns","synth"),
    "full_1ns_synth_rc":rc("full_1ns","synth"),
    "full_2ns_route_attempt_rc":rc("full_2ns","route"),
    "full_1ns_place_attempt_rc":rc("full_1ns","place")
  },
  "asic_lab_disposition":"HOLD",
  "aws_used":False
}
open(os.path.join(res,"EXECUTION_RESULT.json"),"w").write(json.dumps(status,indent=2)+"\n")
patterns=re.compile(r"(chip area|design area|cell area|number of cells|wns|tns|slack|critical path|total power|internal power|switching power|leakage power|clock period|frequency)",re.I)
out=[]
for p in glob.glob(os.path.join(res,"logs","*.log"))+glob.glob(os.path.join(res,"reports","**","*"),recursive=True):
    if not os.path.isfile(p): continue
    try:
        for n,line in enumerate(open(p,errors="ignore"),1):
            if patterns.search(line):
                out.append(f"{os.path.relpath(p,res)}:{n}:{line.rstrip()}")
                if len(out)>=8000: break
    except Exception:
        pass
    if len(out)>=8000: break
open(os.path.join(res,"PPA_SIGNAL_EXTRACT.txt"),"w").write("\n".join(out)+"\n")
PY

for f in "$RESULTS"/logs/*.log; do
  [ -f "$f" ] || continue
  tail -n 1200 "$f" > "$f.tail"
  rm "$f"
  mv "$f.tail" "$f"
done

rm -rf "$WORK"
