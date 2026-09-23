#!/usr/bin/env python3
"""Execute a real local Build Colony planning run; never dispatch product work."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from dataclasses import asdict
from enum import Enum

parser = argparse.ArgumentParser()
parser.add_argument('--build-colony-root', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
engine = args.build_colony_root.resolve()
out = args.output_dir.resolve()
out.mkdir(parents=True, exist_ok=True)
inventory = json.loads((root / 'engine-source.json').read_text())
for item in inventory['files']:
    data = (engine / item['path']).read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if blob != item['git_blob']:
        raise SystemExit('Engine source mismatch: ' + item['path'])
env = dict(os.environ)
env['PYTHONPATH'] = str(engine / 'src')
sys.path.insert(0, str(engine / 'src'))
from build_colony.profile import load_profile
from build_colony.protocol import compile_run, manifest_to_dict
from build_colony.state_models import new_ledger, write_ledger
from build_colony.gate_directed_issue import issue_gate_directed_ready
from build_colony.work_selection import (
    ActiveGateClass, GateRelation, PackageGateBinding, RouteControl, RouteState,
    WorkSelectionContract,
)

def normal(value):
    if isinstance(value, Enum):
        return value.value
    raise TypeError(type(value).__name__)

def write(name, value):
    (out / name).write_text(json.dumps(value, indent=2, sort_keys=True, default=normal) + '\n')

commands = []
def cli(label, *arguments):
    command = [sys.executable, '-c',
               'from build_colony.strict_cli import main; raise SystemExit(main())',
               *map(str, arguments)]
    result = subprocess.run(command, cwd=out, env=env, text=True, capture_output=True)
    (out / (label + '.stdout.json')).write_text(result.stdout)
    if result.stderr:
        (out / (label + '.stderr.log')).write_text(result.stderr)
    commands.append({'label': label, 'entrypoint': 'build_colony.strict_cli:main',
                     'arguments': list(map(str, arguments)), 'exit_code': result.returncode})
    write('commands.json', commands)
    if result.returncode:
        raise SystemExit('Planning command failed: ' + label + ': ' + result.stderr)
    return json.loads(result.stdout)

baseline = json.loads((root / 'baseline.json').read_text())
profile_path = root / 'profile.json'
profile = load_profile(profile_path)
source_revision = baseline['source_revision']
plan = cli('01-plan', 'plan', profile_path)
compiled = cli('02-compile', 'compile-run', profile_path, '--source-revision',
               source_revision, '--output', 'manifest.json')
checked = cli('03-check-manifest', 'check-manifest', 'manifest.json', '--profile', profile_path)
cli('04-ledger-init', 'ledger-init', 'manifest.json', '--profile', profile_path,
    '--output', 'initial-ledger.json')
manifest = compile_run(profile, source_revision)
document = json.loads((out / 'manifest.json').read_text())
assert manifest_to_dict(manifest) == document, 'Independent API/CLI compilation mismatch'
contract = WorkSelectionContract(
    active_gate_class=ActiveGateClass.CAPABILITY_GAP,
    active_gate_evidence_ref='Waterfound/FAE-testnet@' + source_revision + ':wallet.js',
    native_progress_unit='verified_user_acceptance_criteria_out_of_7',
    package_bindings=tuple(PackageGateBinding(
        domain_id=domain.id,
        relation=(GateRelation.DIRECT if domain.id in {'WTX-03-txid-details', 'WTX-04-history-lifecycle'}
                  else GateRelation.REQUIRED_SERIAL_DEPENDENCY),
        route_id='wallet-transaction-ux',
    ) for domain in profile.domains),
    routes=(RouteControl(route_id='wallet-transaction-ux', state=RouteState.ACTIVE,
                         evidence_reason='Pinned source and served frontend prove missing full TXID/copy/detail affordances; see baseline.json.'),),
)
issued = issue_gate_directed_ready(manifest, new_ledger(manifest), contract)
write('selection-contract.json', asdict(contract))
write('selection-decision.json', {
    'decision': asdict(issued.decision),
    'selection_contract_digest': issued.selection_contract_digest,
    'selection_decision_digest': issued.selection_decision_digest,
})
write_ledger(issued.ledger, out / 'ledger.json')
ledger_checked = cli('05-ledger-check', 'ledger-check', 'manifest.json', 'ledger.json',
                     '--profile', profile_path)
frontier = cli('06-frontier', 'frontier', 'manifest.json', 'ledger.json', '--profile', profile_path)
assert issued.decision.eligible_domains == ('WTX-01-contract',)
assert not issued.decision.di_escalation_recommended
write('summary.json', {
    'status': 'PLANNING_RUN_VERIFIED',
    'execution_kind': 'actual local Build Colony CLI and AGDWS calls; no reference runner rehearsal',
    'source_revision': source_revision,
    'engine_revision': inventory['revision'],
    'engine_git_blobs_verified': len(inventory['files']),
    'run_id': compiled['run_id'],
    'manifest_digest': compiled['manifest_digest'],
    'manifest_accepted': checked['accepted'],
    'ledger_accepted': ledger_checked['accepted'],
    'ledger_events': len(issued.ledger.events),
    'ledger_head': issued.ledger.head_event_digest,
    'waves': plan['waves'],
    'frontier': frontier,
    'cli_api_recompilation_matches': True,
    'native_progress_delta': 0,
    'product_work_dispatched': False,
    'worker_results_submitted': 0,
    'independent_agents_run': 0,
    'product_implemented': False,
    'product_validated': False,
    'product_integrated_main': False,
    'product_live': False,
    'scope_note': 'The requested planning stage is complete; ISSUE admits only the next contract package, without executing it.',
})
print(json.dumps({'status': 'PLANNING_RUN_VERIFIED', 'run_id': compiled['run_id'],
                  'waves': plan['waves'], 'next': issued.decision.eligible_domains}, indent=2))
