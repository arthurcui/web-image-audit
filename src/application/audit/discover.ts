import { CoverageFindings } from './coverage.js';
import { loadBuffer } from 'cheerio';
import type { Limits } from './types.js';
import type { Candidate, Occurrence } from '../../shared/audit.js';

/** HTML-style tokenization: commas inside URL tokens (notably data URLs) are retained. */
export function* parseSrcset(
  input: string,
): Generator<{ url: string; descriptor: string; valid: boolean }> {
  let position = 0;
  const space = /[\t\n\f\r ]/;
  while (position < input.length) {
    while (position < input.length && (space.test(input[position]!) || input[position] === ','))
      position++;
    if (position === input.length) break;
    const start = position;
    while (position < input.length && !space.test(input[position]!)) position++;
    let url = input.slice(start, position);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      yield { url, descriptor: '', valid: true };
      continue;
    }
    const descriptors: string[] = [];
    let token = '';
    let parentheses = 0;
    while (position < input.length) {
      const char = input[position++]!;
      if (char === '(') parentheses++;
      if (char === ')') parentheses = Math.max(0, parentheses - 1);
      if (char === ',' && parentheses === 0) break;
      if (space.test(char) && parentheses === 0) {
        if (token) descriptors.push(token);
        token = '';
      } else token += char;
    }
    if (token) descriptors.push(token);
    const descriptor = descriptors.join(' ');
    const single = descriptors[0] ?? '';
    const valid =
      descriptors.length === 0 ||
      (descriptors.length === 1 &&
        ((/^[1-9]\d*w$/.test(single) && Number.isFinite(Number(single.slice(0, -1)))) ||
          (/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?x$/.test(single) &&
            Number.isFinite(Number(single.slice(0, -1))))));
    yield { url, descriptor, valid };
  }
}

export function discover(body: Buffer, finalUrl: string, limits: Limits, charset?: string) {
  const $ = loadBuffer(body, charset ? { encoding: { transportLayerEncodingLabel: charset } } : {});
  const findings = new CoverageFindings();
  let baseUrl = finalUrl;
  const base = $('base[href]').first().attr('href');
  if (base !== undefined) {
    try {
      baseUrl = new URL(base, finalUrl).href;
    } catch {
      findings.add('invalid-base', 'Invalid first base href; final page URL used');
    }
  }
  const occurrences: Occurrence[] = [];
  let candidateCount = 0;
  const images = $('img').toArray();
  if (images.length > limits.maxOccurrences)
    findings.add('occurrence-limit', 'Occurrence limit reached');
  for (const [index, image] of images.slice(0, limits.maxOccurrences).entries()) {
    const alt = $(image).attr('alt');
    const occurrence: Occurrence = {
      id: 'occurrence-' + index,
      alt:
        alt === undefined
          ? { state: 'missing' }
          : { state: alt === '' ? 'empty' : 'text', value: alt },
      candidates: [],
    };
    occurrences.push(occurrence);
    const sources = $(image).parent('picture').children('source').toArray();
    for (const element of [...sources, image]) {
      const tag = element.tagName === 'source' ? 'source' : 'img';
      for (const attribute of [
        'src',
        'srcset',
        'data-src',
        'data-srcset',
        'data-original',
        'data-lazy-src',
      ]) {
        const value = $(element).attr(attribute);
        if (value === undefined) continue;
        const responsive = attribute.endsWith('srcset');
        const entries = responsive
          ? parseSrcset(value)
          : [{ url: value, descriptor: '', valid: true }];
        for (const entry of entries) {
          if (candidateCount >= limits.maxCandidates) {
            findings.add('candidate-limit', 'Candidate limit reached');
            break;
          }
          candidateCount++;
          const candidate: Candidate = {
            rawUrl: entry.url,
            attribute,
            element: tag,
            role: attribute.startsWith('data-')
              ? 'lazy'
              : responsive || tag === 'source'
                ? 'responsive'
                : 'fallback',
            ...(entry.descriptor ? { descriptor: entry.descriptor } : {}),
            ...($(element).attr('media') === undefined ? {} : { media: $(element).attr('media')! }),
            ...($(element).attr('type') === undefined ? {} : { type: $(element).attr('type')! }),
          };
          if (!entry.valid) candidate.skipped = 'Invalid or unsupported srcset descriptor';
          if (!entry.url.trim()) candidate.skipped = 'Empty URL';
          occurrence.candidates.push(candidate);
        }
      }
    }
  }
  return { occurrences, baseUrl, findings };
}
