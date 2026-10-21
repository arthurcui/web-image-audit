import { useEffect, useState } from 'react';
import { ConnectionForm } from './ConnectionForm.js';
import { AuditForm } from './AuditForm.js';
import { RecentAudits } from './RecentAudits.js';
import { AuditDetail } from './AuditDetail.js';
import { McpChat } from './McpChat.js';

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [fixture, setFixture] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/health', { signal: controller.signal })
      .then((r) => r.json())
      .then((v: { mode?: string }) => {
        if (!controller.signal.aborted) setFixture(v.mode === 'fixture');
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
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
          approved.
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
        <ConnectionForm onConnect={setToken} />
      ) : (
        <>
          <AuditWorkspace token={token} />
          <McpChat token={token} />
        </>
      )}
      <footer>
        Static or rendered scans · Local processing · No remote image previews
        <br />
        Demo authentication. Your token stays in memory and is cleared on disconnect or reload.
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
