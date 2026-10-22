import type { AuditResult, Candidate, Occurrence, Resource } from './audit.js';

export interface InventoryRow {
  key: string;
  occurrence: Occurrence;
  candidate: Candidate | null;
  resource: Resource | undefined;
  issues: string[];
}
export function inventory(result: AuditResult): InventoryRow[] {
  const resources = new Map(result.resources.map((resource) => [resource.id, resource]));
  return result.occurrences.flatMap((occurrence) =>
    (occurrence.candidates.length ? occurrence.candidates : [null]).map((candidate, index) => {
      const resource = candidate?.resourceId ? resources.get(candidate.resourceId) : undefined;
      const issues = result.issues
        .filter(
          (issue) =>
            issue.occurrenceId === occurrence.id ||
            (resource !== undefined && issue.resourceId === resource.id),
        )
        .map((issue) => issue.message);
      if (candidate?.skipped) issues.push(candidate.skipped);
      return {
        key: occurrence.id + ':' + index,
        occurrence,
        candidate,
        resource,
        issues: [...new Set(issues)],
      };
    }),
  );
}
export function altLabel(occurrence: Occurrence) {
  return occurrence.alt.state === 'missing'
    ? 'Missing alt'
    : occurrence.alt.state === 'empty'
      ? 'Empty alt (possibly decorative)'
      : 'Text: ' + occurrence.alt.value;
}
export function outcome(row: InventoryRow) {
  if (!row.resource) return row.candidate?.skipped ? 'Skipped' : 'Not inspected';
  return (
    (row.resource.status === undefined ? 'No HTTP response' : 'HTTP ' + row.resource.status) +
    ' · ' +
    row.resource.state +
    (row.resource.code ? ' · ' + row.resource.code : '')
  );
}
export function byteLabel(resource: Resource | undefined) {
  return resource
    ? (resource.bytesComplete ? '' : '≥ ') + resource.bytes.toLocaleString() + ' B'
    : '—';
}
/** Quote every field; neutralize formula prefixes even after leading whitespace/control characters. */
export function csvCell(value: string) {
  // Control characters are intentionally matched to neutralize spreadsheet formula prefixes.
  const safe =
    // oxlint-disable-next-line no-control-regex
    /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function toCsv(result: AuditResult) {
  const rows = inventory(result).map((row) => [
    row.occurrence.id,
    row.occurrence.documentUrl ?? result.page.url,
    row.resource?.id ?? '',
    row.candidate?.url ?? row.candidate?.rawUrl ?? '',
    row.candidate ? row.candidate.element + '[' + row.candidate.attribute + ']' : '',
    row.candidate?.role ?? '',
    row.candidate?.descriptor ?? '',
    row.candidate?.media ?? '',
    outcome(row),
    row.resource?.contentType ?? '',
    row.resource?.bytes.toString() ?? '',
    row.resource?.bytesComplete.toString() ?? '',
    row.occurrence.alt.state,
    row.occurrence.alt.state === 'missing' ? '' : row.occurrence.alt.value,
    row.issues.join('; '),
  ]);
  return (
    [
      [
        'Occurrence ID',
        'Document URL',
        'Resource ID',
        'Image URL',
        'Source attribute',
        'Candidate role',
        'Descriptor',
        'Media',
        'HTTP outcome',
        'Content type',
        'Bytes consumed',
        'Bytes complete',
        'Alt status',
        'Alt text',
        'Issues',
      ],
      ...rows,
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n') + '\r\n'
  );
}
