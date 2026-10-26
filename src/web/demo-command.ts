// Parse the supported scripted demo commands into MCP tool requests.
export type DemoCall =
  | { name: 'start_audit'; arguments: { url: string; idempotencyKey: string } }
  | { name: 'get_audit_status'; arguments: { id: string } }
  | {
      name: 'get_audit_results';
      arguments: { id: string; section: 'issues'; limit: number; cursor?: string };
    }
  | { name: 'list_audits'; arguments: { limit: number } };

export const demoHelp =
  'Try: audit https://example.com/, check its status, show the issues, or list my audits. You can also use status <job-id> and issues <job-id>.';
export function parseDemoCommand(input: string, lastId: string | null, key: string): DemoCall {
  const command = input.trim();
  if (command.length > 2200) throw new Error('Command is too long.');
  const start = /^(?:start an audit(?: of)?|audit)\s+(https?:\/\/\S+)$/i.exec(command);
  if (start) {
    const url = new URL(start[1]!);
    if (url.username || url.password || url.href.length > 2048)
      throw new Error('Use a URL without embedded credentials, up to 2048 characters.');
    return { name: 'start_audit', arguments: { url: url.href, idempotencyKey: key } };
  }
  if (/^list(?: my)? audits[.!?]?$/i.test(command))
    return { name: 'list_audits', arguments: { limit: 5 } };
  const status = /^(?:check (?:its |the )?status|status)(?:\s+([0-9a-f-]{36}))?[.!?]?$/i.exec(
    command,
  );
  const issues = /^(?:show (?:the )?issues|issues)(?:\s+([0-9a-f-]{36}))?[.!?]?$/i.exec(command);
  if (status || issues) {
    const id = (status ?? issues)![1] ?? lastId;
    if (!id) throw new Error('Start an audit first, or include its job ID.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Use a valid job ID.');
    return status
      ? { name: 'get_audit_status', arguments: { id } }
      : { name: 'get_audit_results', arguments: { id, section: 'issues', limit: 5 } };
  }
  throw new Error(demoHelp);
}
