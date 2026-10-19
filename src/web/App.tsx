import { useEffect, useState } from 'react';
import { isHealthResponse } from '../shared/health.js';

type Connection = 'checking' | 'connected' | 'error';

export function App() {
  const [connection, setConnection] = useState<Connection>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    setConnection('checking');
    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!isHealthResponse(body)) throw new Error('Unexpected health response');
        if (active) setConnection('connected');
      } catch {
        if (active) setConnection('error');
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void checkHealth();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  return (
    <main>
      <header><span className="brand">W / IA</span><span>LOCAL DEVELOPMENT</span></header>
      <section className="intro">
        <p className="eyebrow">MILESTONE 01 · FOUNDATION</p>
        <h1>Website<br />Image Audit<span className="accent">.</span></h1>
        <p className="description">A clearer picture of the images on your website.</p>
      </section>
      <section className="panel" aria-labelledby="connection-title">
        <div><p className="eyebrow">SYSTEM CHECK</p><h2 id="connection-title">API connection</h2></div>
        <p role="status" className={`status ${connection}`}>
          {connection === 'checking' ? 'Checking…' : connection === 'connected' ? 'Connected · API healthy' : 'Connection failed · start the API and retry'}
        </p>
        <button disabled={connection === 'checking'} onClick={() => setAttempt((value) => value + 1)}>Check again <span aria-hidden="true">↗</span></button>
      </section>
      <footer><code>GET /api/health</code><p>Scaffold only. URL submission, image inventory, background jobs, and MCP tools arrive in later milestones.</p></footer>
    </main>
  );
}
