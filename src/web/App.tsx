import { useEffect, useState } from 'react';
import { ConnectionForm } from './ConnectionForm.js';
import { AuditForm } from './AuditForm.js';
import { RecentAudits } from './RecentAudits.js';
import { AuditDetail } from './AuditDetail.js';
import { McpChat } from './McpChat.js';

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [fixture, setFixture] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const health = await fetch('/api/health', { signal: controller.signal });
        if (!health.ok) return;
        const value = (await health.json()) as { mode?: string };
        if (controller.signal.aborted) return;
        setFixture(value.mode === 'fixture');
        if (value.mode !== 'fixture') return;
        setConnecting(true);
        setConnectionError(null);
        const response = await fetch('/api/demo/session', {
          method: 'POST',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error('Fixture sign-in failed. Check the local demo API and retry.');
        const session = (await response.json()) as { token?: unknown };
        if (typeof session.token !== 'string' || !/^wia_[A-Za-z0-9_-]{43}$/.test(session.token))
          throw new Error('Fixture sign-in returned an invalid response.');
        if (!controller.signal.aborted) setToken(session.token);
      } catch (error) {
        if (!controller.signal.aborted)
          setConnectionError(
            error instanceof Error ? error.message : 'Unable to connect to the demo.',
          );
      } finally {
        if (!controller.signal.aborted) setConnecting(false);
      }
    })();
    return () => controller.abort();
  }, [connectionAttempt]);
  return (
    <main>
      <header>
        <span className="brand">
          WIA<span className="brand-name"> / Website Image Audit</span>
        </span>
        <div className="actions">
          <span className="local-dot">LOCAL DEMO</span>
          {token && (
            <button className="secondary" onClick={() => setToken(null)}>
              Disconnect
            </button>
          )}
        </div>
      </header>
      {fixture && (
        <p className="notice" role="status">
          <strong>FIXTURE MODE</strong> · Isolated demo database. Only http://127.0.0.1:3105 is
          approved. Automatic sign-in uses a shared fixture identity.
        </p>
      )}
      <section className="intro">
        <p className="eyebrow">LOOK CLOSER. LOAD LIGHTER.</p>
        <h1>
          A clearer picture
          <br />
          of your images<span className="accent">.</span>
        </h1>
        <p className="description">
          Inspect image candidates, spot delivery issues, and review text alternatives.
        </p>
      </section>
      {token === null ? (
        fixture ? (
          <section className="panel" aria-label="Fixture connection">
            {connecting ? (
              <p role="status">Connecting to the local fixture…</p>
            ) : (
              <>
                {connectionError && <p role="alert">{connectionError}</p>}
                <button onClick={() => setConnectionAttempt((value) => value + 1)}>
                  Connect to demo
                </button>
              </>
            )}
          </section>
        ) : (
          <ConnectionForm onConnect={setToken} />
        )
      ) : (
        <>
          <AuditWorkspace token={token} />
          <McpChat token={token} />
        </>
      )}
      <footer>
        Static or rendered scans · Local processing · No remote image previews
        <br />
        Demo authentication. Tokens stay in memory. Fixture mode signs in automatically on reload.
      </footer>
    </main>
  );
}
function AuditWorkspace({ token }: { token: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  return (
    <>
      <AuditForm
        token={token}
        onCreated={(id) => {
          setSelected(id);
          setRevision((value) => value + 1);
        }}
      />
      <div className="workspace">
        <RecentAudits key={revision} token={token} selected={selected} onSelect={setSelected} />
        {selected ? (
          <AuditDetail
            key={selected}
            id={selected}
            token={token}
            onClose={() => setSelected(null)}
          />
        ) : (
          <section className="panel selection-empty">
            <p className="eyebrow">REVIEW AUDIT RESULTS</p>
            <h2>Your findings, in focus</h2>
            <p className="muted">
              Start an audit or select a recent one to inspect its progress and image inventory.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
