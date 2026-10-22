import type Database from 'better-sqlite3';
import type { AuditResult, Resource, Occurrence, Candidate } from '../../shared/audit.js';
import { summarizeAudit } from '../../shared/summary.js';
import type {
  ResultHeader,
  ResultQuery,
  StoredPage,
  InventoryRow,
} from '../../shared/result-query.js';
import { JobError } from '../../application/jobs.js';
export const normalizedSchema = `
CREATE TABLE audit_results(job_id TEXT NOT NULL REFERENCES audits(id),attempt INTEGER NOT NULL,header_json TEXT NOT NULL,PRIMARY KEY(job_id,attempt)) STRICT;
CREATE TABLE image_resources(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,id TEXT NOT NULL,state TEXT NOT NULL,bytes INTEGER NOT NULL,oversized INTEGER NOT NULL,metadata_json TEXT NOT NULL,PRIMARY KEY(job_id,attempt,ordinal),UNIQUE(job_id,attempt,id),FOREIGN KEY(job_id,attempt) REFERENCES audit_results(job_id,attempt) ON DELETE CASCADE) STRICT;
CREATE TABLE image_occurrences(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,image_ordinal INTEGER NOT NULL,id TEXT NOT NULL,document_id TEXT,alt_state TEXT NOT NULL,alt_text TEXT,metadata_json TEXT NOT NULL,PRIMARY KEY(job_id,attempt,ordinal),UNIQUE(job_id,attempt,id),FOREIGN KEY(job_id,attempt) REFERENCES audit_results(job_id,attempt) ON DELETE CASCADE) STRICT;
CREATE TABLE image_candidates(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,occurrence_ordinal INTEGER NOT NULL,resource_id TEXT,attribute TEXT NOT NULL,role TEXT NOT NULL,metadata_json TEXT NOT NULL,PRIMARY KEY(job_id,attempt,ordinal),FOREIGN KEY(job_id,attempt,occurrence_ordinal) REFERENCES image_occurrences(job_id,attempt,ordinal) ON DELETE CASCADE,FOREIGN KEY(job_id,attempt,resource_id) REFERENCES image_resources(job_id,attempt,id)) STRICT;
CREATE INDEX candidates_occurrence ON image_candidates(job_id,attempt,occurrence_ordinal,ordinal);
CREATE INDEX resources_outcome ON image_resources(job_id,attempt,state,id);
CREATE INDEX resources_oversized ON image_resources(job_id,attempt,oversized,id);
CREATE INDEX occurrences_alt ON image_occurrences(job_id,attempt,alt_state,ordinal);
CREATE TABLE audit_documents(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,id TEXT NOT NULL,parent_url TEXT,kind TEXT NOT NULL,url TEXT NOT NULL,state TEXT NOT NULL,depth INTEGER NOT NULL,PRIMARY KEY(job_id,attempt,ordinal),FOREIGN KEY(job_id,attempt) REFERENCES audit_results(job_id,attempt) ON DELETE CASCADE) STRICT;
CREATE TABLE audit_issues(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,scope TEXT NOT NULL,code TEXT NOT NULL,message TEXT NOT NULL,occurrence_id TEXT,resource_id TEXT,PRIMARY KEY(job_id,attempt,ordinal),FOREIGN KEY(job_id,attempt) REFERENCES audit_results(job_id,attempt) ON DELETE CASCADE) STRICT;
CREATE INDEX issues_occurrence ON audit_issues(job_id,attempt,occurrence_id);
CREATE INDEX issues_resource ON audit_issues(job_id,attempt,resource_id);
CREATE INDEX issues_scope ON audit_issues(job_id,attempt,scope,ordinal);
`;
export function prepareResult(result: AuditResult, attempt: number) {
  let imageOrdinal = 0;
  const occurrences = result.occurrences.map((o, ordinal) => {
    const first = imageOrdinal;
    imageOrdinal += Math.max(1, o.candidates.length);
    const { id, alt, candidates, documentId, ...metadata } = o;
    return {
      ordinal,
      first,
      id,
      alt,
      documentId: documentId ?? null,
      metadata: JSON.stringify(metadata),
      candidates: candidates.map((c, i) => {
        const { attribute, role, resourceId, ...data } = c;
        return {
          ordinal: first + i,
          attribute,
          role,
          resourceId: resourceId ?? null,
          metadata: JSON.stringify(data),
        };
      }),
    };
  });
  const resources = result.resources.map((r, ordinal) => {
    const { id, state, bytes, oversized, ...metadata } = r;
    return {
      ordinal,
      id,
      state,
      bytes,
      oversized: Number(oversized),
      metadata: JSON.stringify(metadata),
    };
  });
  const counts = {
    summary: 0,
    resources: resources.length,
    occurrences: occurrences.length,
    candidates: result.occurrences.reduce((n, o) => n + o.candidates.length, 0),
    inventory: imageOrdinal,
    issues: result.issues.length + result.coverage.findings.length,
    documents: result.documents?.length ?? 0,
    coverage: result.coverage.findings.length,
  };
  const header: ResultHeader = {
    attempt,
    summary: summarizeAudit(result),
    metadata: {
      page: result.page,
      ...(result.scan ? { scan: result.scan } : {}),
      ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
      coverage: { complete: result.coverage.complete },
    },
    counts,
  };
  const issues = [
    ...result.issues.map((i) => ({ ...i, scope: 'image' })),
    ...result.coverage.findings.map((i) => ({
      ...i,
      scope: 'coverage',
      occurrenceId: undefined,
      resourceId: undefined,
    })),
  ];
  return {
    header: JSON.stringify(header),
    resources,
    occurrences,
    issues,
    documents: result.documents ?? [],
  };
}
export function publishResult(
  db: Database.Database,
  id: string,
  attempt: number,
  data: ReturnType<typeof prepareResult>,
) {
  db.prepare('DELETE FROM audit_results WHERE job_id=?').run(id);
  db.prepare('INSERT INTO audit_results VALUES (?,?,?)').run(id, attempt, data.header);
  const resource = db.prepare('INSERT INTO image_resources VALUES (?,?,?,?,?,?,?,?)');
  for (const r of data.resources)
    resource.run(id, attempt, r.ordinal, r.id, r.state, r.bytes, r.oversized, r.metadata);
  const occurrence = db.prepare('INSERT INTO image_occurrences VALUES (?,?,?,?,?,?,?,?,?)');
  const candidate = db.prepare('INSERT INTO image_candidates VALUES (?,?,?,?,?,?,?,?)');
  for (const o of data.occurrences) {
    occurrence.run(
      id,
      attempt,
      o.ordinal,
      o.first,
      o.id,
      o.documentId,
      o.alt.state,
      o.alt.state === 'missing' ? null : o.alt.value,
      o.metadata,
    );
    for (const c of o.candidates)
      candidate.run(
        id,
        attempt,
        c.ordinal,
        o.ordinal,
        c.resourceId,
        c.attribute,
        c.role,
        c.metadata,
      );
  }
  const doc = db.prepare('INSERT INTO audit_documents VALUES (?,?,?,?,?,?,?,?,?)');
  data.documents.forEach((d, i) =>
    doc.run(id, attempt, i, d.id, d.parentUrl ?? null, d.kind, d.url, d.state, d.depth),
  );
  const issue = db.prepare('INSERT INTO audit_issues VALUES (?,?,?,?,?,?,?,?)');
  data.issues.forEach((v, i) =>
    issue.run(
      id,
      attempt,
      i,
      v.scope,
      v.code,
      v.message,
      v.occurrenceId ?? null,
      v.resourceId ?? null,
    ),
  );
}
type Row = Record<string, unknown>;
function resource(row: Row): Resource {
  return {
    ...JSON.parse(String(row.metadata_json)),
    id: String(row.id),
    state: row.state,
    bytes: Number(row.bytes),
    oversized: row.oversized === 1,
  } as Resource;
}
function occurrence(row: Row): Occurrence {
  return {
    ...JSON.parse(String(row.metadata_json)),
    id: String(row.id),
    ...(row.document_id ? { documentId: String(row.document_id) } : {}),
    alt:
      row.alt_state === 'missing'
        ? { state: 'missing' }
        : { state: row.alt_state, value: row.alt_text },
    candidates: [],
  } as Occurrence;
}
function candidate(row: Row): Candidate {
  return {
    ...JSON.parse(String(row.metadata_json)),
    attribute: String(row.attribute),
    role: row.role,
    ...(row.resource_id ? { resourceId: String(row.resource_id) } : {}),
  } as Candidate;
}
/** Snapshot transaction ends before the caller serializes a response or yields an export chunk. */
export function readResultPage(
  db: Database.Database,
  id: string,
  owner: string,
  q: ResultQuery,
): StoredPage | undefined {
  return db.transaction(() => {
    const job = db
      .prepare('SELECT state,attempts FROM audits WHERE id=? AND owner_id=?')
      .get(id, owner) as { state: StoredPage['state']; attempts: number } | undefined;
    if (!job) return undefined;
    const saved = db
      .prepare('SELECT header_json FROM audit_results WHERE job_id=? AND attempt=?')
      .get(id, job.attempts) as { header_json: string } | undefined;
    const header = saved ? (JSON.parse(saved.header_json) as ResultHeader) : null;
    if (
      q.cursor &&
      (!header ||
        q.cursor.jobId !== id ||
        q.cursor.attempt !== header.attempt ||
        q.cursor.section !== q.section ||
        q.cursor.filter !== q.filter)
    )
      throw new JobError(
        'stale_cursor',
        'Result changed or cursor belongs to another view; restart pagination',
      );
    if (!header || q.section === 'summary')
      return { state: job.state, header, items: [], total: 0, hasMore: false };
    const after = q.cursor?.after ?? -1;
    const args = [id, header.attempt];
    let values: Array<{ ordinal: number; value: unknown }> = [];
    let total = header.counts[q.section];
    if (q.section === 'inventory' || q.section === 'candidates') {
      const joins = `FROM image_occurrences o LEFT JOIN image_candidates c ON c.job_id=o.job_id AND c.attempt=o.attempt AND c.occurrence_ordinal=o.ordinal LEFT JOIN image_resources r ON r.job_id=c.job_id AND r.attempt=c.attempt AND r.id=c.resource_id WHERE o.job_id=? AND o.attempt=?`;
      const condition =
        (q.section === 'candidates' ? ' AND c.ordinal IS NOT NULL' : '') +
        (q.filter === 'failed'
          ? " AND r.state='failed'"
          : q.filter === 'oversized'
            ? ' AND r.oversized=1'
            : q.filter === 'missing'
              ? " AND o.alt_state='missing'"
              : '');
      if (q.filter !== 'all')
        total = (db.prepare(`SELECT count(*) n ${joins}${condition}`).get(...args) as { n: number })
          .n;
      // Fetch joined values in one statement; indexed correlated issue lookups avoid
      // one application/database round-trip per candidate. Only a bounded page is hydrated.
      const rows = db
        .prepare(
          `WITH selected AS MATERIALIZED (
          SELECT COALESCE(c.ordinal,o.image_ordinal) ordinal,o.ordinal occurrence_ordinal,c.ordinal candidate_ordinal
          ${joins}${condition} AND COALESCE(c.ordinal,o.image_ordinal)>?
          ORDER BY COALESCE(c.ordinal,o.image_ordinal) LIMIT ?
        ) SELECT selected.ordinal,
        o.id o_id,o.document_id,o.alt_state,o.alt_text,o.metadata_json o_metadata,
        c.ordinal c_ordinal,c.attribute,c.role,c.resource_id,c.metadata_json c_metadata,
        r.id r_id,r.state,r.bytes,r.oversized,r.metadata_json r_metadata,
        (SELECT json_group_array(message) FROM (
          SELECT ordinal,message FROM audit_issues WHERE job_id=o.job_id AND attempt=o.attempt AND occurrence_id=o.id
          UNION SELECT ordinal,message FROM audit_issues WHERE job_id=o.job_id AND attempt=o.attempt AND resource_id=c.resource_id
          ORDER BY ordinal)) issues_json
        FROM selected
        JOIN image_occurrences o ON o.job_id=? AND o.attempt=? AND o.ordinal=selected.occurrence_ordinal
        LEFT JOIN image_candidates c ON c.job_id=o.job_id AND c.attempt=o.attempt AND c.ordinal=selected.candidate_ordinal
        LEFT JOIN image_resources r ON r.job_id=c.job_id AND r.attempt=c.attempt AND r.id=c.resource_id
        ORDER BY selected.ordinal`,
        )
        .iterate(...args, after, q.limit + 1, ...args);
      let hydratedBytes = 0;
      for (const raw of rows) {
        const row = raw as Row;
        const o = occurrence({ ...row, id: row.o_id, metadata_json: row.o_metadata });
        const c =
          row.c_ordinal === null ? null : candidate({ ...row, metadata_json: row.c_metadata });
        const r =
          row.r_id === null
            ? undefined
            : resource({ ...row, id: row.r_id, metadata_json: row.r_metadata });
        const issues = JSON.parse(String(row.issues_json)) as string[];
        if (c?.skipped) issues.push(c.skipped);
        const value: InventoryRow = {
          key: String(row.ordinal),
          occurrence: o,
          candidate: c,
          resource: r,
          issues: [...new Set(issues)],
        };
        values.push({ ordinal: Number(row.ordinal), value });
        hydratedBytes += Buffer.byteLength(JSON.stringify(value));
        // Keep the first over-budget row as lookahead, not in the response.
        if (values.length > 1 && hydratedBytes > 131072) break;
      }
    } else {
      const tables = {
        resources: 'image_resources',
        occurrences: 'image_occurrences',
        issues: 'audit_issues',
        coverage: 'audit_issues',
        documents: 'audit_documents',
      };
      const scope = q.section === 'coverage' ? " AND scope='coverage'" : '';
      const rows = db
        .prepare(
          `SELECT * FROM ${tables[q.section]} WHERE job_id=? AND attempt=?${scope} AND ordinal>? ORDER BY ordinal LIMIT ?`,
        )
        .all(...args, after, q.limit + 1) as Row[];
      values = rows.map((row) => {
        let value: unknown;
        if (q.section === 'resources') value = resource(row);
        else if (q.section === 'occurrences') {
          const o = occurrence(row);
          o.candidates = (
            db
              .prepare(
                'SELECT * FROM image_candidates WHERE job_id=? AND attempt=? AND occurrence_ordinal=? ORDER BY ordinal',
              )
              .all(...args, row.ordinal as number) as Row[]
          ).map(candidate);
          value = o;
        } else if (q.section === 'documents')
          value = {
            id: row.id,
            url: row.url,
            kind: row.kind,
            depth: row.depth,
            state: row.state,
            ...(row.parent_url ? { parentUrl: row.parent_url } : {}),
          };
        else
          value = {
            code: row.code,
            message: row.message,
            ...(q.section === 'issues' ? { scope: row.scope } : {}),
            ...(row.occurrence_id ? { occurrenceId: row.occurrence_id } : {}),
            ...(row.resource_id ? { resourceId: row.resource_id } : {}),
          };
        return { ordinal: Number(row.ordinal), value };
      });
    }
    let bytes = 0;
    const selected: typeof values = [];
    for (const row of values.slice(0, q.limit)) {
      const size = Buffer.byteLength(JSON.stringify(row.value));
      if (selected.length && bytes + size > 131072) break;
      selected.push(row);
      bytes += size;
    }
    return {
      state: job.state,
      header,
      items: selected,
      total,
      hasMore: values.length > selected.length,
    };
  })();
}
