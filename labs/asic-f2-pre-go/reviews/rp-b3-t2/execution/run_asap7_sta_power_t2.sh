#!/usr/bin/env bash
set -euo pipefail

VARIANT="${T2_VARIANT:?T2_VARIANT must be full, argon, or rw5}"
ROOT="${GITHUB_WORKSPACE}"
T1="${ROOT}/labs/asic-f2-pre-go/reviews/rp-b3-t1"
T2="${ROOT}/labs/asic-f2-pre-go/reviews/rp-b3-t2"
WORK="${T2}/work/${VARIANT}"
RESULTS="${T2}/results/${VARIANT}"
EXPECTED="c0bf48c3864b72352ba57a2d6c17175c1c6a59dffae52c8fa73a5d346bc60a33"
ORFS_COMMIT="a12d46907510891a2e3d3310abdd19975d28db0e"
ASAP7_TREE_EXPECTED="102f845a9d321d1a0f7db10434ad84e54c0334b5"
PERIOD_NS="5.5"
CORNER="BC"

case "$VARIANT" in
  full)
    TOP="fae_dp6_hls"
    NICK="full_bc_5p5ns"
    TARGET="cts"
    ;;
  argon)
    TOP="fae_dp6_hls_argon2d_fixed"
    NICK="argon_bc_5p5ns"
    TARGET="synth"
    ;;
  rw5)
    TOP="fae_dp6_hls_rw5"
    NICK="rw5_bc_5p5ns"
    TARGET="synth"
    ;;
  *)
    echo "unsupported T2_VARIANT=$VARIANT" >&2
    exit 2
    ;;
esac

rm -rf "$WORK" "$RESULTS"
mkdir -p "$WORK/c6_export" "$RESULTS/reports" "$RESULTS/logs" "$RESULTS/config"

cat "$T1"/input/c6_export.part*.b64 | tr -d '\r\n\t ' | base64 -d > "$WORK/c6_export.zip"
ACTUAL="$(sha256sum "$WORK/c6_export.zip" | awk '{print $1}')"
BYTES="$(stat -c %s "$WORK/c6_export.zip")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  printf '{"schema":"fae.dp6.rp_b3_t2.execution_result.v1","variant":"%s","status":"FAIL_INTEGRITY","expected":"%s","actual":"%s"}\n' "$VARIANT" "$EXPECTED" "$ACTUAL" > "$RESULTS/EXECUTION_RESULT.json"
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
if [ "$ORFS_HEAD" != "$ORFS_COMMIT" ] || [ "$ASAP7_TREE" != "$ASAP7_TREE_EXPECTED" ]; then
  echo "ORFS/ASAP7 pin mismatch" >&2
  exit 21
fi

docker pull openroad/orfs:latest > "$RESULTS/logs/docker-pull.txt"
IMAGE_ID="$(docker image inspect openroad/orfs:latest --format '{{.Id}}')"
IMAGE_DIGEST="$(docker image inspect openroad/orfs:latest --format '{{join .RepoDigests "\n"}}' | head -1)"

{
  echo "orfs_commit=$ORFS_HEAD"
  echo "asap7_tree=$ASAP7_TREE"
  echo "container_id=$IMAGE_ID"
  echo "container_digest=$IMAGE_DIGEST"
  docker run --rm openroad/orfs:latest bash -lc 'source ./env.sh >/dev/null 2>&1; yosys -V; openroad -version'
} > "$RESULTS/logs/tool-versions.txt"

SRC="$WORK/orfs/flow/designs/src/fae_dp6_rp_b3_t2"
mkdir -p "$SRC"
cp "$WORK/c6_export"/hdl/verilog/*.v "$SRC/"
VERILOG_COUNT="$(find "$SRC" -name '*.v' | wc -l)"
ASAP7_CONTENT_SHA="$(find "$WORK/orfs/flow/platforms/asap7" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"

LIB_DIR="$WORK/orfs/flow/platforms/asap7/lib/NLDM"
find "$LIB_DIR" -maxdepth 1 -type f \( -name '*RVT_FF_nldm*' -o -name '*RVT_FF_nldm*.gz' \) -print0 | sort -z | xargs -0 sha256sum > "$RESULTS/config/bc_rvt_library_sha256.txt" || true
cp "$WORK/orfs/flow/platforms/asap7/config.mk" "$RESULTS/config/asap7-platform-config.mk"

DESIGN_DIR="$WORK/orfs/flow/designs/asap7/fae_dp6_rp_b3_t2/$NICK"
mkdir -p "$DESIGN_DIR"
cat > "$DESIGN_DIR/config.mk" <<EOF
export PLATFORM = asap7
export DESIGN_NAME = $TOP
export DESIGN_NICKNAME = $NICK
export VERILOG_FILES = $(sort $(wildcard $(DESIGN_HOME)/src/fae_dp6_rp_b3_t2/*.v))
export SDC_FILE = $(DESIGN_HOME)/$(PLATFORM)/fae_dp6_rp_b3_t2/$NICK/constraint.sdc
export CORNER = $CORNER
export LIB_MODEL = NLDM
export ASAP7_USE_VT = RVT
export CORE_UTILIZATION = 40
export CORE_ASPECT_RATIO = 1
export CORE_MARGIN = 2
export PLACE_DENSITY = 0.60
export TNS_END_PERCENT = 100
export SYNTH_USE_SYN = 1
export SYNTH_HDL_FRONTEND = slang
export SKIP_REPORT_METRICS = 0
export REPORT_CLOCK_SKEW = 1
EOF

cat > "$DESIGN_DIR/constraint.sdc" <<EOF
current_design $TOP
set clk_period $PERIOD_NS
set clk_port [get_ports ap_clk]
create_clock -name core_clock -period $clk_period $clk_port
set non_clock_inputs [all_inputs -no_clocks]
set_input_delay [expr $clk_period * 0.10] -clock core_clock $non_clock_inputs
set_output_delay [expr $clk_period * 0.10] -clock core_clock [all_outputs]
EOF

cp "$DESIGN_DIR/config.mk" "$RESULTS/config/config.mk"
cp "$DESIGN_DIR/constraint.sdc" "$RESULTS/config/constraint.sdc"

CFG="designs/asap7/fae_dp6_rp_b3_t2/$NICK/config.mk"
set +e
docker run --rm -u "$(id -u):$(id -g)" \
  -v "$WORK/orfs/flow:/OpenROAD-flow-scripts/flow" \
  -w /OpenROAD-flow-scripts \
  openroad/orfs:latest bash -lc "source ./env.sh && cd flow && make DESIGN_CONFIG=$CFG clean_all $TARGET" >"$RESULTS/logs/flow.log" 2>&1
FLOW_RC=$?
set -e
echo "$FLOW_RC" > "$RESULTS/logs/flow.rc"

ORFS_REPORT_DIR="$WORK/orfs/flow/reports/asap7/$NICK/base"
ORFS_LOG_DIR="$WORK/orfs/flow/logs/asap7/$NICK/base"
ORFS_RESULT_DIR="$WORK/orfs/flow/results/asap7/$NICK/base"

if [ -d "$ORFS_REPORT_DIR" ]; then
  find "$ORFS_REPORT_DIR" -type f -size -3000k -print0 | while IFS= read -r -d '' f; do
    rel="${f#$ORFS_REPORT_DIR/}"
    mkdir -p "$RESULTS/reports/$(dirname "$rel")"
    cp "$f" "$RESULTS/reports/$rel"
  done
fi

if [ -d "$ORFS_LOG_DIR" ]; then
  find "$ORFS_LOG_DIR" -type f -size -3000k -print0 | while IFS= read -r -d '' f; do
    rel="${f#$ORFS_LOG_DIR/}"
    mkdir -p "$RESULTS/logs/orfs/$(dirname "$rel")"
    cp "$f" "$RESULTS/logs/orfs/$rel"
  done
fi

# Preserve only compact final-stage structural metadata, not large ODB/netlists.
if [ -d "$ORFS_RESULT_DIR" ]; then
  find "$ORFS_RESULT_DIR" -maxdepth 1 -type f \( -name '*.sdc' -o -name 'clock_period.txt' \) -size -1000k -print0 | while IFS= read -r -d '' f; do
    cp "$f" "$RESULTS/config/$(basename "$f")"
  done
fi

python3 - <<PY
import glob, json, os, re, hashlib
res=os.path.join("labs/asic-f2-pre-go/reviews/rp-b3-t2/results","$VARIANT")
texts=[]
for p in glob.glob(os.path.join(res,"reports","**","*"),recursive=True)+glob.glob(os.path.join(res,"logs","orfs","**","*"),recursive=True)+[os.path.join(res,"logs","flow.log")]:
    if os.path.isfile(p):
        try:
            txt=open(p,errors="ignore").read()
        except Exception:
            continue
        texts.append((p,txt))

signals=[]
rx=re.compile(r"(report_wns|report_tns|report_worst_slack|report_clock_min_period|critical path delay|critical path slack|report_power|Design area|Total Power|Internal Power|Switching Power|Leakage Power|setup violation count|hold violation count|clock period|fmax|worst slack|WNS|TNS)",re.I)
for p,txt in texts:
    for n,line in enumerate(txt.splitlines(),1):
        if rx.search(line):
            signals.append(f"{os.path.relpath(p,res)}:{n}:{line}")
open(os.path.join(res,"PPA_SIGNAL_EXTRACT.txt"),"w").write("\n".join(signals)+"\n")

prov={
  "schema":"fae.dp6.rp_b3_t2.tool_provenance.v1",
  "variant":"$VARIANT",
  "top":"$TOP",
  "target":"$TARGET",
  "source_revision":os.environ.get("GITHUB_SHA"),
  "executor":{"provider":"github-actions","run_id":os.environ.get("GITHUB_RUN_ID"),"run_attempt":os.environ.get("GITHUB_RUN_ATTEMPT"),"runner_os":os.environ.get("RUNNER_OS"),"runner_arch":os.environ.get("RUNNER_ARCH")},
  "c6_sha256":"$ACTUAL",
  "c6_bytes":int("$BYTES"),
  "equivalence":"PASS_EQUIVALENCE",
  "frontend":"slang",
  "orfs_commit":"$ORFS_HEAD",
  "asap7_tree":"$ASAP7_TREE",
  "asap7_content_sha256":"$ASAP7_CONTENT_SHA",
  "container_image_id":"$IMAGE_ID",
  "container_repo_digest":"$IMAGE_DIGEST",
  "technology":{"name":"ASAP7","role":"predictive research platform; not production-foundry evidence","process_nm_predictive":7,"corner":"BC","temperature_C":25,"voltage_V":0.77,"library_model":"NLDM","vt":"RVT"},
  "constraint":{"clock_period_ns":float("$PERIOD_NS"),"input_delay_fraction":0.10,"output_delay_fraction":0.10,"core_utilization_percent":40,"place_density":0.60},
  "power_boundary":"No VCD/SAIF supplied. OpenROAD report_power therefore reflects its default/statistical activity treatment and is admitted only as predictive sensitivity, not measured workload power.",
  "verilog_file_count":int("$VERILOG_COUNT")
}
open(os.path.join(res,"TOOL_PROVENANCE.json"),"w").write(json.dumps(prov,indent=2)+"\n")

result={
  "schema":"fae.dp6.rp_b3_t2.execution_result.v1",
  "variant":"$VARIANT",
  "top":"$TOP",
  "target":"$TARGET",
  "flow_rc":int("$FLOW_RC"),
  "integrity":"PASS",
  "equivalence":"PASS_EQUIVALENCE",
  "asic_lab":"HOLD",
  "aws_fpga_used":False,
  "paid_provider_used":False
}
open(os.path.join(res,"EXECUTION_RESULT.json"),"w").write(json.dumps(result,indent=2)+"\n")

manifest={}
for p in sorted(glob.glob(os.path.join(res,"**","*"),recursive=True)):
    if os.path.isfile(p):
        manifest[os.path.relpath(p,res)]=hashlib.sha256(open(p,"rb").read()).hexdigest()
open(os.path.join(res,"FILE_SHA256.json"),"w").write(json.dumps(manifest,indent=2)+"\n")
PY

# Keep the top-level flow log bounded for artifact size.
tail -n 5000 "$RESULTS/logs/flow.log" > "$RESULTS/logs/flow.log.tail"
mv "$RESULTS/logs/flow.log.tail" "$RESULTS/logs/flow.log"

rm -rf "$WORK"

exit "$FLOW_RC"
