SQLite migrations and the persistent store live here. Transactions are synchronous and short; network work stays in the independent audit engine.

Persistence uses three narrow interfaces over one SqliteJobStore implementation:

- AuditRepository: creation and reads require an explicit owner ID. AuditService
  obtains that ID from authentication; callers cannot supply it as proof of identity.
  Missing/blank ownership is rejected at runtime and SQL always filters owner_id.
- WorkerQueue: privileged cross-owner claims and lease-fenced heartbeat, progress,
  completion and failure operations. Only the trusted worker receives this interface;
  it has no arbitrary audit reads or token methods.
- TokenRepository: hash storage and token-to-user lookup for authentication and
  local provisioning, with no audit or queue operations.

These are TypeScript capability boundaries, not a sandbox for malicious in-process
code. API and MCP continue to authenticate through AuditService. The SQLite class
implements all three so connection handling and transactions remain centralized.

See the root README for lease fencing and retry semantics.
