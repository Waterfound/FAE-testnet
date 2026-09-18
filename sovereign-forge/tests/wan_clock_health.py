#!/usr/bin/env python3
"""Read-only host clock diagnostics; no clock setting or network probes."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time

SCHEMA = 'FAE_WAN_CLOCK_HEALTH_V1'
READINESS_SCHEMA = 'FAE_WAN_CLOCK_READINESS_V1'
POLICY = 'arrival-wall-enforced-replay-intrinsic-v1'
BUDGET_MS = 30000


def command(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=3,
                                env={**os.environ, 'LC_ALL': 'C', 'SYSTEMD_COLORS': '0', 'SYSTEMD_PAGER': 'cat'})
        return {'code': result.returncode, 'stdout': result.stdout[:8192], 'stderr': result.stderr[:1024]}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'code': None, 'stdout': '', 'stderr': type(error).__name__}


def fields(text):
    return {key.strip().lower(): value.strip() for key, value in
            (line.split(':', 1) for line in text.splitlines() if ':' in line)}


def duration_ms(text):
    match = re.match(r'^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(ns|us|µs|μs|ms|s|seconds)\b', text, re.I)
    if not match:
        raise ValueError('duration_unavailable')
    value = float(match[1]) * {'ns': 1e-6, 'us': .001, 'µs': .001, 'μs': .001, 'ms': 1, 's': 1000, 'seconds': 1000}[match[2].lower()]
    if not math.isfinite(value):
        raise ValueError('nonfinite_duration')
    return value


def assess(raw):
    """Evaluate service reports, never replace missing evidence with zero."""
    synchronized = raw.get('synchronized', {}).get('code') == 0 and raw['synchronized']['stdout'].strip() == 'yes'
    try:
        tracking = raw.get('chrony', {})
        if tracking.get('code') == 0:
            f = fields(tracking['stdout'])
            if f.get('leap status') != 'Normal' or not 1 <= int(f.get('stratum', '0')) <= 15:
                raise ValueError('chrony_not_synchronized')
            if f.get('reference id', '').split(' ')[0].upper() in ('00000000', '7F7F0101', ''):
                raise ValueError('chrony_reference_unavailable')
            offset = abs(duration_ms(f['system time']))
            distance = abs(duration_ms(f['root delay'])) / 2 + duration_ms(f['root dispersion'])
            backend = 'chrony-tracking'
            synchronized = True  # chronyd's own synchronization state
        else:
            report = raw.get('timesync', {})
            if report.get('code') != 0:
                raise ValueError('quantitative_clock_report_unavailable')
            f = fields(report['stdout'])
            if f.get('leap') != 'normal' or not 1 <= int(f.get('stratum', '0')) <= 15 or int(f.get('packet count', '0')) < 1:
                raise ValueError('timesync_not_synchronized')
            offset = abs(duration_ms(f['offset']))
            distance = duration_ms(f['root distance'])
            backend = 'systemd-timesync-status'
        if distance < 0:
            raise ValueError('negative_root_distance')
        estimate = offset + distance
        ok = synchronized and estimate <= BUDGET_MS
        return {'status': 'PASS' if ok else 'FAIL', 'backend': backend,
                'synchronized': synchronized, 'reported_offset_abs_ms': offset,
                'reported_root_distance_ms': distance, 'reported_error_envelope_ms': estimate,
                'budget_ms': BUDGET_MS, 'independent_utc_proof': False}
    except (KeyError, ValueError, TypeError) as error:
        return {'status': 'UNKNOWN', 'backend': None, 'synchronized': synchronized,
                'reported_error_envelope_ms': None, 'reason': str(error),
                'budget_ms': BUDGET_MS, 'independent_utc_proof': False}


def sample(role, sha, run, phase):
    wall = time.time_ns()
    mono = time.monotonic_ns()
    raw = {
        'synchronized': command(['timedatectl', 'show', '--property=NTPSynchronized', '--value']),
        'chrony': command(['chronyc', '-n', 'tracking']),
        'timesync': command(['timedatectl', 'timesync-status', '--no-pager']),
    }
    return {'schema': SCHEMA, 'role': role, 'source_sha': sha, 'run_id': run, 'phase': phase,
            'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'runner_name': os.environ.get('RUNNER_NAME', 'unknown'),
            'wall_ns': wall, 'monotonic_ns': mono, 'probe_elapsed_ms': (time.monotonic_ns()-mono)/1e6,
            'raw': raw, 'assessment': assess(raw)}


def stable_tail(records, required):
    streak = 0
    for row in records:
        if row['assessment']['status'] == 'PASS':
            streak += 1
        else:
            streak = 0
    return streak >= required


def preflight(args):
    """Wait read-only for a bounded stable synchronization window, but never set time."""
    deadline = time.monotonic() + args.timeout_seconds
    records = []
    while True:
        records.append(sample(args.role, args.sha, args.run, 'readiness'))
        if stable_tail(records, args.stable_samples):
            status = 'PASS'
            break
        if time.monotonic() >= deadline:
            status = 'INCOMPLETE'
            break
        time.sleep(args.interval_seconds)

    first = records[0]
    result = {
        'schema': READINESS_SCHEMA,
        'role': args.role,
        'source_sha': args.sha,
        'run_id': args.run,
        'status': status,
        'stable_samples_required': args.stable_samples,
        'samples': len(records),
        'boot_id': first['boot_id'],
        'runner_name': first['runner_name'],
        'final_assessment': records[-1]['assessment'],
        'independent_utc_proof': False,
        'records': records,
    }
    Path(args.out).write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps({key: result[key] for key in (
        'schema', 'role', 'source_sha', 'run_id', 'status', 'stable_samples_required',
        'samples', 'boot_id', 'runner_name', 'independent_utc_proof')}))
    return 0


def collect(args):
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    with open(args.out, 'x', encoding='utf8') as output:
        def write(phase):
            output.write(json.dumps(sample(args.role, args.sha, args.run, phase), allow_nan=False)+'\n')
            output.flush()
        write('start')
        while not stop.wait(10):
            write('periodic')
        write('end')


def verify_records(records, sha, run):
    if len(records) < 2 or records[0]['phase'] != 'start' or records[-1]['phase'] != 'end':
        raise ValueError('incomplete_clock_capture')
    first = records[0]
    if not re.fullmatch(r'[0-9a-f-]{36}', first['boot_id']):
        raise ValueError('invalid_boot_identity')
    errors, assessments, steps, gaps = [], [], [], []
    for index, row in enumerate(records):
        if any(type(row[key]) is not int or not 0 < row[key] < 2**64 for key in ('wall_ns', 'monotonic_ns')):
            raise ValueError('invalid_clock_counter')
        if (row['schema'], row['source_sha'], row['run_id'], row['role'], row['boot_id'], row['runner_name']) != (SCHEMA, sha, run, first['role'], first['boot_id'], first['runner_name']):
            raise ValueError('clock_capture_identity_mismatch')
        assessment = assess(row['raw'])
        if assessment != row['assessment']:
            raise ValueError('clock_assessment_mismatch')
        assessments.append(assessment)
        if assessment['status'] != 'PASS':
            errors.append(assessment.get('reason', 'clock_envelope_failed'))
        if not math.isfinite(row['probe_elapsed_ms']) or not 0 <= row['probe_elapsed_ms'] <= 15000:
            errors.append('slow_clock_probe')
        if index:
            previous = records[index-1]
            delta = (row['monotonic_ns']-previous['monotonic_ns'])/1e6
            step = abs((row['wall_ns']-previous['wall_ns'])/1e6-delta)
            if delta <= 0 or delta > 45000:
                errors.append('clock_sampling_gap')
            if step > 1000:
                errors.append('wall_monotonic_discontinuity')
            steps.append(step); gaps.append(delta)
    duration = (records[-1]['monotonic_ns']-first['monotonic_ns'])/1e9
    if duration < 20:
        errors.append('clock_capture_too_short')
    estimates = [x['reported_error_envelope_ms'] for x in assessments if x['reported_error_envelope_ms'] is not None]
    return {'role': first['role'], 'boot_id': first['boot_id'], 'runner_name': first['runner_name'],
            'status': 'PASS' if not errors else 'INCOMPLETE', 'errors': sorted(set(errors)),
            'samples': len(records), 'duration_seconds': duration,
            'backends': sorted({x['backend'] for x in assessments if x['backend']}),
            'max_reported_error_envelope_ms': max(estimates) if estimates else None,
            'max_wall_monotonic_difference_ms': max(steps), 'max_sample_gap_ms': max(gaps),
            'independent_utc_proof': False}


def verify_readiness(result, sha, run):
    required = {'schema', 'role', 'source_sha', 'run_id', 'status', 'stable_samples_required',
                'samples', 'boot_id', 'runner_name', 'final_assessment', 'records'}
    if not required.issubset(result):
        raise ValueError('incomplete_clock_readiness')
    if result['schema'] != READINESS_SCHEMA or result['source_sha'] != sha or str(result['run_id']) != run:
        raise ValueError('clock_readiness_identity_mismatch')
    if result['role'] not in 'ABCD' or not re.fullmatch(r'[0-9a-f-]{36}', result['boot_id']):
        raise ValueError('invalid_clock_readiness_identity')
    records = result['records']
    if not records or result['samples'] != len(records) or result['stable_samples_required'] < 2:
        raise ValueError('invalid_clock_readiness_capture')
    for row in records:
        if (row['schema'], row['source_sha'], str(row['run_id']), row['role'], row['boot_id'], row['runner_name']) != (SCHEMA, sha, run, result['role'], result['boot_id'], result['runner_name']):
            raise ValueError('clock_readiness_record_identity_mismatch')
        assessment = assess(row['raw'])
        if assessment != row['assessment']:
            raise ValueError('clock_readiness_assessment_mismatch')
    expected = 'PASS' if stable_tail(records, result['stable_samples_required']) else 'INCOMPLETE'
    if result['status'] != expected or result['final_assessment'] != records[-1]['assessment']:
        raise ValueError('clock_readiness_result_mismatch')
    return result


def verify_bundle(args):
    rows = []
    for path in sorted(Path(args.directory).rglob('clock-health.jsonl')):
        records = [json.loads(line) for line in path.read_text().splitlines()]
        rows.append(verify_records(records, args.sha, args.run))
    if sorted(x['role'] for x in rows) != ['A', 'B', 'C', 'D']:
        raise ValueError('four_clock_roles_required')
    if len({x['boot_id'] for x in rows}) != 4 or len({x['runner_name'] for x in rows}) != 4 or any(x['runner_name']=='unknown' for x in rows):
        raise ValueError('four_clock_hosts_required')

    readiness_rows = []
    for path in sorted(Path(args.directory).rglob('clock-readiness.json')):
        readiness_rows.append(verify_readiness(json.loads(path.read_text()), args.sha, args.run))
    if sorted(x['role'] for x in readiness_rows) != ['A', 'B', 'C', 'D']:
        raise ValueError('four_clock_readiness_roles_required')
    readiness_by_role = {x['role']: x for x in readiness_rows}
    for row in rows:
        ready = readiness_by_role[row['role']]
        if (row['boot_id'], row['runner_name']) != (ready['boot_id'], ready['runner_name']):
            raise ValueError('clock_readiness_host_mismatch:'+row['role'])
        row['readiness_status'] = ready['status']
        row['readiness_samples'] = ready['samples']
        if ready['status'] != 'PASS':
            row['status'] = 'INCOMPLETE'
            row['errors'] = sorted(set(row['errors'] + ['clock_readiness_failed']))

    observer = list(Path(args.directory).rglob('observer-pass.json'))
    if len(observer) != 1:
        raise ValueError('observer_result_required')
    observation = json.loads(observer[0].read_text())
    if str(observation['run_id']) != args.run or observation.get('status') != 'PASS':
        raise ValueError('network_observation_failed')
    by_role = {x['role']: x for x in rows}
    if (by_role['D']['boot_id'], by_role['D']['runner_name']) != (observation['observer_boot_id'], observation['observer_runner']):
        raise ValueError('observer_clock_identity_mismatch')
    for role, name in [('A', 'a-final-public.json'), ('B', 'b-final-public.json'), ('C', 'c-final-public.json')]:
        endpoint = json.loads((observer[0].parent / (role.lower()+'-endpoint.json')).read_text())
        if str(endpoint['run_id']) != args.run or (by_role[role]['boot_id'], by_role[role]['runner_name']) != (endpoint['boot_id'], endpoint['runner_name']):
            raise ValueError('endpoint_clock_identity_mismatch:'+role)
        paths = list(observer[0].parent.glob(name))
        if len(paths) != 1 or json.loads(paths[0].read_text()).get('timestamp_policy') != POLICY:
            raise ValueError('arrival_policy_marker_required:'+role)
    result = {'schema': SCHEMA, 'source_sha': args.sha, 'run_id': args.run,
              'status': 'PASS' if all(x['status']=='PASS' for x in rows) and args.network_success == 'yes' else 'INCOMPLETE',
              'network_observation': 'PASS', 'network_jobs_success': args.network_success == 'yes', 'distinct_clock_hosts': 4, 'hosts': rows,
              'clock_readiness_required': True, 'independent_utc_proof': False, 'time_equivalent_soak': False}
    Path(args.out).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))
    return 0 if result['status']=='PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='action', required=True)
    readiness = sub.add_parser('preflight')
    readiness.add_argument('--role', choices=list('ABCD'), required=True)
    readiness.add_argument('--out', required=True)
    readiness.add_argument('--timeout-seconds', type=float, default=30)
    readiness.add_argument('--stable-samples', type=int, default=2)
    readiness.add_argument('--interval-seconds', type=float, default=1)
    capture = sub.add_parser('collect')
    capture.add_argument('--role', choices=list('ABCD'), required=True)
    capture.add_argument('--out', required=True)
    check = sub.add_parser('verify-bundle')
    check.add_argument('directory'); check.add_argument('--out', required=True)
    check.add_argument('--network-success', choices=['yes', 'no'], required=True)
    for p in (readiness, capture, check):
        p.add_argument('--sha', required=True); p.add_argument('--run', required=True)
    args = parser.parse_args()
    if args.action == 'preflight':
        if args.timeout_seconds <= 0 or args.stable_samples < 2 or args.interval_seconds <= 0:
            parser.error('preflight bounds must be positive and stable-samples >= 2')
        raise SystemExit(preflight(args))
    if args.action == 'collect':
        collect(args)
    else:
        raise SystemExit(verify_bundle(args))
