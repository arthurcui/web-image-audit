import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AuditJob } from '../shared/jobs.js';
import { requestAuditApi } from './client.js';
import { errorMessage } from './format.js';

export function ConnectionForm({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const credential = value.trim();
    if (!credential) {
      setError('Enter a demo token.');
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      await requestAuditApi<{ jobs: AuditJob[] }>(credential, '?limit=1', current.signal);
      if (!current.signal.aborted) {
        setValue('');
        onConnect(credential);
      }
    } catch (cause) {
      if (!current.signal.aborted)
        setError(errorMessage(cause).replace('Disconnect and enter', 'Enter'));
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel connection" aria-labelledby="connect-title">
      <p className="eyebrow">01 / CONNECT</p>
      <h2 id="connect-title">Connect to your local workspace</h2>
      <p className="muted">
        Enter a provisioned demo token. It is sent only to the local API and is never saved in
        browser storage.
      </p>
      <form
        onSubmit={(event) => {
          void connect(event);
        }}
      >
        <label htmlFor="token">Local demo token</label>
        <div className="input-row">
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            disabled={busy}
            aria-describedby="token-help"
          />
          <button disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
        </div>
        <p id="token-help" className="muted">
          Generate one in the project terminal with <code>npm run auth:token -- your-user-id</code>.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
