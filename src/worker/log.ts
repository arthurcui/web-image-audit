// Write structured worker events without tokens or target URLs.
export interface AuditLogEvent {
  event:
    | 'worker_started'
    | 'worker_stopping'
    | 'worker_error'
    | 'audit_claimed'
    | 'audit_completed'
    | 'audit_failed'
    | 'audit_retry'
    | 'audit_lease_lost';
  auditId?: string;
  attempt?: number;
  resources?: number;
}
/** Explicit field projection prevents accidental exception, URL or credential serialization. */
export function writeAuditLog(
  value: AuditLogEvent,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
) {
  write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: value.event === 'worker_error' ? 'error' : 'info',
      event: value.event,
      ...(value.auditId && /^[0-9a-f-]{36}$/i.test(value.auditId)
        ? { auditId: value.auditId }
        : {}),
      ...(Number.isSafeInteger(value.attempt) ? { attempt: value.attempt } : {}),
      ...(Number.isSafeInteger(value.resources) ? { resources: value.resources } : {}),
    }) + '\n',
  );
}
