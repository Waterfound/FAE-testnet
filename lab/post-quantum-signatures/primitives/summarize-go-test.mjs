import { readFile, writeFile } from 'node:fs/promises';

const input = process.env.PQ_GO_TEST_JSON;
const output = process.env.PQ_EVIDENCE_PATH;
const label = process.env.PQ_GO_TEST_LABEL || 'go-test';
if (!input || !output) throw new Error('PQ_GO_TEST_JSON and PQ_EVIDENCE_PATH are required');

const lines = (await readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean);
const counts = { pass: 0, fail: 0, skip: 0, run: 0, output: 0 };
const skipped = [];
const failed = [];
for (const line of lines) {
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (row.Action && Object.hasOwn(counts, row.Action)) counts[row.Action]++;
  if (row.Action === 'skip' && row.Test) skipped.push(row.Test);
  if (row.Action === 'fail' && row.Test) failed.push(row.Test);
}
if (counts.fail > 0 || failed.length > 0) {
  throw new Error(label + ' contains failing tests: ' + JSON.stringify(failed.slice(0, 20)));
}
const evidence = {
  schema: 'FAE_PQ_GO_TEST_SUMMARY_V1',
  label,
  result: 'PASS',
  counts,
  skipped_tests: skipped
};
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
