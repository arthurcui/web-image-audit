import { createServer } from 'node:http';
const svg = (label: string, width = 320, height = 160) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#285741"/><text x="20" y="${height / 2}" font-size="${width >= 1000 ? 36 : 18}" fill="white">${label}</text></svg>`;
const large = svg('Oversized fixture - 600 KB+', 1200, 600).replace(
  '</svg>',
  '<!--' + 'x'.repeat(600_000) + '--></svg>',
);
export function createFixtureServer() {
  return createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>LOCAL FIXTURE - Website Image Audit</title>
        <style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.5}img{max-width:100%;height:auto}section{margin:32px 0}picture{display:block}</style></head><body>
        <h1>LOCAL FIXTURE - deterministic audit demo</h1><p>Six occurrences, five unique resources, seven candidates. One missing alt, one empty alt, one HTTP failure, one oversized resource.</p>
        <section><h2>Shared image, different alt attributes</h2>
        <img src="/shared.svg" alt="Shared illustration"><img src="/shared.svg" alt=""><img src="/shared.svg"></section>
        <section><h2>Responsive image</h2><p>Below 768 px: a dedicated 320 x 160 fallback. At 768 px and above: a 1280 x 640 source shown at 640 x 320 (2x). Resize the window to compare.</p>
        <picture><source media="(min-width: 768px)" srcset="/wide.svg 2x"><img src="/small.svg" alt="Responsive illustration"></picture></section>
        <section><h2>Broken image</h2><img src="/broken.svg" alt="Intentionally broken"></section>
        <section><h2>Oversized image</h2><p>Displayed at up to 1200 x 600. Its file exceeds 600 KB because of deterministic padding; visual dimensions alone do not determine file size.</p>
        <img src="/large.svg" width="1200" height="600" alt="Intentionally large"></section>
        <a href="/dynamic.html">Optional rendered/iframe demonstration</a></body></html>`);
    } else if (path === '/dynamic.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><title>LOCAL FIXTURE - rendered</title><body><h1>Rendered fixture</h1><script>setTimeout(()=>{const i=document.createElement("img");i.src="/shared.svg";i.alt="Inserted by JavaScript";document.body.append(i)},50)</script><iframe src="/frame.html" title="Fixture frame"></iframe></body>',
      );
    } else if (path === '/frame.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><title>Fixture frame</title><img src="/wide.svg" alt="Frame illustration">',
      );
    } else if (['/shared.svg', '/small.svg', '/wide.svg', '/large.svg'].includes(path!)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(
        path === '/large.svg'
          ? large
          : path === '/wide.svg'
            ? svg('Wide responsive image', 1280, 640)
            : svg(path === '/small.svg' ? 'Small responsive fallback' : 'Shared image'),
      );
    } else {
      res.statusCode = 404;
      res.end('Intentional fixture 404');
    }
  });
}
