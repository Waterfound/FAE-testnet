import unittest
from wan_clock_health import (
    assess,
    duration_ms,
    verify_records,
    verify_readiness,
    stable_tail,
    SCHEMA,
    READINESS_SCHEMA,
)

CHRONY = '''Reference ID : 12345678 (ntp.example)
Stratum : 3
System time : 0.002 seconds slow of NTP time
Root delay : 0.010 seconds
Root dispersion : 0.003 seconds
Leap status : Normal
'''
TIMESYNC = '''Server: 192.0.2.1
Leap: normal
Stratum: 3
Root distance: 335us (max: 5s)
Offset: +316us
Packet count: 12
'''


def raw(chrony=CHRONY):
    return {'synchronized': {'code': 0, 'stdout': 'yes\n'},
            'chrony': {'code': 0 if chrony else 1, 'stdout': chrony or ''},
            'timesync': {'code': 0, 'stdout': TIMESYNC}}


def records():
    result = []
    for i in range(3):
        report = raw()
        result.append({'schema': SCHEMA, 'role': 'A', 'source_sha': 'a'*40, 'run_id': '123',
                       'runner_name': 'runner-A', 'boot_id': '12345678-1234-1234-1234-123456789012',
                       'phase': ['start', 'periodic', 'end'][i], 'wall_ns': 1760000000000000000+i*10_000_000_000,
                       'monotonic_ns': 100000000000+i*10_000_000_000, 'probe_elapsed_ms': 10,
                       'raw': report, 'assessment': assess(report)})
    return result


def readiness(statuses=('PASS', 'PASS')):
    rows = []
    for i, status in enumerate(statuses):
        report = raw() if status == 'PASS' else raw(CHRONY.replace('Normal', 'Not synchronised'))
        rows.append({'schema': SCHEMA, 'role': 'A', 'source_sha': 'a'*40, 'run_id': '123',
                     'runner_name': 'runner-A', 'boot_id': '12345678-1234-1234-1234-123456789012',
                     'phase': 'readiness', 'wall_ns': 1760000000000000000+i*1_000_000_000,
                     'monotonic_ns': 100000000000+i*1_000_000_000, 'probe_elapsed_ms': 10,
                     'raw': report, 'assessment': assess(report)})
    passed = stable_tail(rows, 2)
    return {'schema': READINESS_SCHEMA, 'role': 'A', 'source_sha': 'a'*40, 'run_id': '123',
            'status': 'PASS' if passed else 'INCOMPLETE', 'stable_samples_required': 2,
            'samples': len(rows), 'boot_id': rows[0]['boot_id'], 'runner_name': rows[0]['runner_name'],
            'final_assessment': rows[-1]['assessment'], 'independent_utc_proof': False,
            'records': rows}


class ClockHealthTests(unittest.TestCase):
    def test_chrony_envelope(self):
        a = assess(raw())
        self.assertEqual(a['status'], 'PASS')
        self.assertAlmostEqual(a['reported_error_envelope_ms'], 10)
        self.assertFalse(a['independent_utc_proof'])

    def test_timesync_and_units(self):
        a = assess(raw(None))
        self.assertEqual(a['status'], 'PASS')
        self.assertAlmostEqual(a['reported_error_envelope_ms'], .651)
        self.assertEqual(duration_ms('-12ms'), -12)
        self.assertEqual(duration_ms('1µs'), .001)
        self.assertEqual(duration_ms('1.5e-3 seconds'), 1.5)

    def test_missing_and_unsynchronized_not_zero(self):
        self.assertEqual(assess({})['status'], 'UNKNOWN')
        for report in [CHRONY.replace('Normal', 'Not synchronised'), CHRONY.replace('12345678', '00000000')]:
            a = assess(raw(report))
            self.assertEqual(a['status'], 'UNKNOWN')
            self.assertIsNone(a['reported_error_envelope_ms'])
        r = raw(None); r['synchronized']['stdout'] = 'no'
        self.assertEqual(assess(r)['status'], 'FAIL')

    def test_over_budget_fails(self):
        self.assertEqual(assess(raw(CHRONY.replace('0.002 seconds', '31 seconds')))['status'], 'FAIL')

    def test_complete_identity_bound_capture(self):
        result = verify_records(records(), 'a'*40, '123')
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['duration_seconds'], 20)

    def test_missing_end_and_identity_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            verify_records(records()[:-1], 'a'*40, '123')
        with self.assertRaisesRegex(ValueError, 'identity'):
            verify_records(records(), 'b'*40, '123')

    def test_changed_assessment_rejected(self):
        r = records(); r[1]['assessment']['reported_error_envelope_ms'] = 0
        with self.assertRaisesRegex(ValueError, 'assessment'):
            verify_records(r, 'a'*40, '123')

    def test_step_gap_and_unknown_remain_incomplete(self):
        for mode in ['step', 'gap', 'missing', 'nan']:
            r = records()
            if mode == 'step': r[-1]['wall_ns'] += 2_000_000_000
            elif mode == 'gap': r[-1]['monotonic_ns'] += 50_000_000_000
            elif mode == 'nan': r[1]['probe_elapsed_ms'] = float('nan')
            else: r[1]['raw'] = {}; r[1]['assessment'] = assess({})
            self.assertEqual(verify_records(r, 'a'*40, '123')['status'], 'INCOMPLETE')

    def test_readiness_requires_consecutive_passes(self):
        self.assertTrue(stable_tail(readiness(('PASS', 'PASS'))['records'], 2))
        self.assertFalse(stable_tail(readiness(('PASS', 'UNKNOWN'))['records'], 2))
        self.assertTrue(stable_tail(readiness(('UNKNOWN', 'PASS', 'PASS'))['records'], 2))

    def test_readiness_is_recomputed_from_raw_evidence(self):
        result = readiness(('UNKNOWN', 'PASS', 'PASS'))
        checked = verify_readiness(result, 'a'*40, '123')
        self.assertEqual(checked['status'], 'PASS')
        result['status'] = 'INCOMPLETE'
        with self.assertRaisesRegex(ValueError, 'result'):
            verify_readiness(result, 'a'*40, '123')


if __name__ == '__main__':
    unittest.main()
