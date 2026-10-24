import { createServer } from 'node:http';
import { fixtureImage } from './fixture-images.js';
const images = {
  '/shared.svg': fixtureImage('shared'),
  '/small.svg': fixtureImage('small'),
  '/wide.svg': fixtureImage('wide'),
  '/large.svg': fixtureImage('large'),
};
export function createFixtureServer() {
  return createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>LOCAL FIXTURE - Website Image Audit</title>
        <style>body{font-family:system-ui,sans-serif;margin:0;padding:32px clamp(16px,4vw,48px);line-height:1.6;background:#f5f4ee;color:#213d35}main{max-width:1280px;margin:auto}h1{line-height:1.2}h2{margin-top:0}section{margin:32px 0;padding:clamp(16px,3vw,32px);background:#fff;border:1px solid #dde3d9;border-radius:18px}.image-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:24px}figure{margin:20px 0 0;padding:16px;background:#f6f7f2;border:1px solid #e1e6dc;border-radius:12px}.image-grid figure{margin:0}img{display:block;max-width:100%;height:auto;border-radius:8px}figcaption{margin-top:14px;color:#52635b;font-size:.9rem}picture{display:block}.broken{min-height:100px}a{color:#285c4a}</style></head><body><main>
        <h1>LOCAL FIXTURE - deterministic audit demo</h1><p>Six occurrences, five unique resources, seven candidates. One missing alt, one empty alt, one HTTP failure, one oversized resource.</p>
        <section><h2>Shared image, different alt attributes</h2>
        <p>One campsite illustration, reused three times. Each HTML occurrence has its own alt attribute.</p><div class="image-grid"><figure><img src="/shared.svg" alt="A golden tent beside a mountain lake"><figcaption>Descriptive alt: a golden tent beside a mountain lake.</figcaption></figure><figure><img src="/shared.svg" alt=""><figcaption>Empty alt: intentionally marked decorative for this example.</figcaption></figure><figure><img src="/shared.svg"><figcaption>Missing alt: flagged for review.</figcaption></figure></div></section>
        <section><h2>Responsive image</h2><p>Below 768 px: a dedicated 320 x 160 fallback. At 768 px and above: a 1280 x 640 source shown at 640 x 320 (2x). Resize the window to compare.</p>
        <figure><picture><source media="(min-width: 768px)" srcset="/wide.svg 2x"><img src="/small.svg" alt="A canoe on a mountain lake"></picture><figcaption>Warm sunset on small screens; a wider daylight view on larger screens.</figcaption></figure></section>
        <section><h2>Broken image</h2><figure><img class="broken" src="/broken.svg" alt="Intentionally broken"><figcaption>This request deliberately returns HTTP 404.</figcaption></figure></section>
        <section><h2>Oversized image</h2><p>Displayed at up to 1200 x 600. Its file exceeds 600 KB because of deterministic padding; visual dimensions alone do not determine file size.</p>
        <figure><img src="/large.svg" width="1200" height="600" alt="A sailboat beside a wooded coastline and distant mountains"><figcaption>Large coastal illustration: over 600 KB with deterministic padding.</figcaption></figure></section>
        <a href="/dynamic.html">Optional rendered/iframe demonstration</a></main></body></html>`);
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
      res.end(images[path as keyof typeof images]);
    } else {
      res.statusCode = 404;
      res.end('Intentional fixture 404');
    }
  });
}
