/** Deterministic local illustrations; no network assets or text baked into images. */
export function fixtureImage(kind: 'shared' | 'small' | 'wide' | 'large'): string {
  const width = kind === 'large' ? 1200 : kind === 'wide' ? 1280 : 320;
  const height = width / 2;
  const coast = kind === 'large';
  const sunset = kind === 'small';
  const sky = coast ? '#d6edf0' : sunset ? '#f6d5bd' : '#dae7e0';
  const distant = coast ? '#7c9da1' : sunset ? '#b58a83' : '#8ba99d';
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 600">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#fff4db"/></linearGradient>
      <linearGradient id="water" x2="0" y2="1"><stop stop-color="#7fb8bb"/><stop offset="1" stop-color="#326d78"/></linearGradient>
    </defs>
    <path fill="url(#sky)" d="M0 0h1200v600H0z"/>
    <circle cx="${sunset ? 350 : 920}" cy="145" r="64" fill="#edb86f"/>
    <g fill="#fffdf5" opacity=".65"><ellipse cx="220" cy="115" rx="110" ry="18"/><ellipse cx="600" cy="85" rx="90" ry="13"/></g>
    <path fill="${distant}" d="M0 355 175 170 335 330 550 100 800 340 990 205 1200 350V600H0z"/>
    <path fill="#f1f1df" d="m475 190 75-90 95 116-71-31-28 24-26-39z"/>
    <path fill="#507b71" d="m0 385 215-115 150 150 175-80 200 95 245-130 215 95v200H0z"/>
    <path fill="url(#water)" d="M0 420q280-42 600 0t600-10v190H0z"/>
    <g stroke="#d4e7d8" stroke-width="4" opacity=".6"><path d="M480 455h190m-130 22h240m-330 28h110m225 24h190m-400 30h130"/></g>
    ${
      coast
        ? `<path fill="#e9cf9d" d="M0 420q150 25 300 125t355 55H0z"/><path fill="#375f50" d="M0 355q165-45 280 100L115 525 0 500z"/>
      <g transform="translate(880 380)"><path fill="#fdf6e6" d="M0 0v100h-85z"/><path fill="#e9b172" d="M8 20v80h65z"/><path fill="#294e52" d="M-100 109H85l-26 25H-70z"/><path stroke="#294e52" stroke-width="5" d="M0-10v120"/></g>
      <g fill="#fffdf6"><path d="m700 150 18 9 18-9-18 18z"/><path d="m760 180 14 7 14-7-14 14z"/></g>`
        : `<path fill="#315c4b" d="M0 445q170-50 360 80t410 75H0z"/>
      <g fill="#274d40"><path d="m100 225-80 190h160z"/><path d="m185 285-70 170h140z"/><path d="m1080 250-95 220h190z"/></g>
      <g stroke="#735b45" stroke-width="12"><path d="M100 365v140m85-90v100m895-115v170"/></g>
      ${kind === 'shared' ? '<path fill="#dfa453" d="m230 385-115 150h260z"/><path fill="#f1c77c" d="m230 385 145 150h110L330 385z"/><path fill="#394f45" d="m230 425-55 110h110z"/><ellipse cx="460" cy="557" rx="42" ry="10" fill="#b9a084"/>' : '<path fill="#d99c65" d="m720 510 135-5-25 24h-85z"/><path stroke="#f5dfac" stroke-width="5" d="m790 460 40 80"/>'}`
    }
  </svg>`;
  // Preserve the oversized-byte example independently of visual dimensions.
  return coast ? scene.replace('</svg>', '<!--' + 'x'.repeat(600_000) + '--></svg>') : scene;
}
