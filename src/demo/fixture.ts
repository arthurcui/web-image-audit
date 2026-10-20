import { createServer } from 'node:http';
const svg = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#285741"/><text x="20" y="80" fill="white">${label}</text></svg>`;
const large = svg('Oversized fixture').replace('</svg>', '<!--' + 'x'.repeat(600_000) + '--></svg>');
export function createFixtureServer() {
  return createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><title>LOCAL FIXTURE - Website Image Audit</title><body>
        <h1>LOCAL FIXTURE - deterministic audit demo</h1><p>Six occurrences, four unique resources, seven candidates. One missing alt, one empty alt, one HTTP failure, one oversized resource.</p>
        <img src="/shared.svg" alt="Shared illustration"><img src="/shared.svg" alt=""><img src="/shared.svg">
        <picture><source srcset="/wide.svg 2x"><img src="/shared.svg" alt="Responsive illustration"></picture>
        <img src="/broken.svg" alt="Intentionally broken"><img src="/large.svg" alt="Intentionally large">
        <a href="/dynamic.html">Optional rendered/iframe demonstration</a></body></html>`);
    } else if (path === '/dynamic.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>LOCAL FIXTURE - rendered</title><body><h1>Rendered fixture</h1><script>setTimeout(()=>{const i=document.createElement("img");i.src="/shared.svg";i.alt="Inserted by JavaScript";document.body.append(i)},50)</script><iframe src="/frame.html" title="Fixture frame"></iframe></body>');
    } else if (path === '/frame.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>Fixture frame</title><img src="/wide.svg" alt="Frame illustration">');
    } else if (['/shared.svg', '/wide.svg', '/large.svg'].includes(path!)) {
      res.setHeader('Content-Type', 'image/svg+xml'); res.end(path === '/large.svg' ? large : svg(path === '/wide.svg' ? 'Responsive candidate' : 'Shared image'));
    } else { res.statusCode = 404; res.end('Intentional fixture 404'); }
  });
}
