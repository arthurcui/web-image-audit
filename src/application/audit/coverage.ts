// Collect stable coverage findings without duplicate entries.
import type { CoverageCode, CoverageFinding } from '../../shared/audit.js';

/** Deduplicate exact findings while preserving first-seen order. Codes never depend on display text. */
export class CoverageFindings {
  private readonly entries = new Map<string, CoverageFinding>();
  add(code: CoverageCode, message: string) {
    this.entries.set(JSON.stringify([code, message]), { code, message });
  }
  get size() {
    return this.entries.size;
  }
  [Symbol.iterator]() {
    return this.entries.values();
  }
}
