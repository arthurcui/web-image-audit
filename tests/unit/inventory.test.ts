import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, inventory, toCsv } from '../../src/web/inventory.js';
import type { AuditResult } from '../../src/shared/audit.js';

test('CSV neutralizes formula prefixes, quotes, delimiters and line breaks', () => {
  for (const value of ['=SUM(1,2)', '+cmd', '-1+2', '@SUM(A1)', '  =1', '\t=1', '\rhello', '\nhello', '\u0001=1']) {
    assert.ok(csvCell(value).startsWith('"\''), 'formula or control prefix must be neutralized');
  }
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('https://example.com/a?x=1'), '"https://example.com/a?x=1"');
});
test('inventory preserves occurrence alt text, missing sources, and shared resource references', () => {
  const result: AuditResult = {
    page: { url: 'https://example.com', state: 'ok', bytes: 1, bytesComplete: true, attempts: 1 },
    resources: [{ id: 'r', requestedUrl: 'https://example.com/a', url: 'https://example.com/a', state: 'ok', bytes: 8, bytesComplete: true, attempts: 1, oversized: false }],
    occurrences: [
      { id: 'one', alt: { state: 'missing' }, candidates: [{ rawUrl: '/a', attribute: 'src', element: 'img', role: 'fallback', resourceId: 'r' }] },
      { id: 'two', alt: { state: 'empty', value: '' }, candidates: [{ rawUrl: '/a', attribute: 'src', element: 'img', role: 'fallback', resourceId: 'r' }] },
      { id: 'three', alt: { state: 'text', value: '=SUM(1,2)' }, candidates: [] },
    ],
    issues: [], coverage: { complete: true, reasons: [] },
  };
  const rows = inventory(result);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.resource, rows[1]!.resource);
  assert.equal(rows[0]!.occurrence.alt.state, 'missing');
  assert.equal(rows[1]!.occurrence.alt.state, 'empty');
  assert.equal(rows[2]!.candidate, null);
  assert.ok(toCsv(result).includes('"\'=SUM(1,2)"'));
});
