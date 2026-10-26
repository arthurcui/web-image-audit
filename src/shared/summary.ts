// Count audit outcomes without implying candidate visibility.
import type { AuditResult } from './audit.js';
/** Counts describe candidates and inspection outcomes, not actual browser visibility. */
export function summarizeAudit(result: AuditResult) {
  return {
    uniqueResources: result.resources.length,
    htmlOccurrences: result.occurrences.length,
    candidates: result.occurrences.reduce((n, o) => n + o.candidates.length, 0),
    issues: result.issues.length,
    failedResources: result.resources.filter((r) => r.state === 'failed').length,
    oversizedResources: result.resources.filter((r) => r.oversized).length,
    missingAlt: result.occurrences.filter((o) => o.alt.state === 'missing').length,
    emptyAlt: result.occurrences.filter((o) => o.alt.state === 'empty').length,
    coverageComplete: result.coverage.complete,
    coverageFindingCount: result.coverage.findings.length,
    pageState: result.page.state,
  };
}
