export class PolicyError extends Error {
  constructor(
    public readonly code: 'policy' | 'invalid-url',
    message: string,
  ) {
    super(message);
  }
}

/** Central policy for initial URLs, discovered candidates, and every redirect. */
export function createUrlPolicy(approvedHosts: readonly string[]) {
  const allowed = new Set(
    approvedHosts.map((host) => {
      const parsed = new URL('https://' + host);
      if (
        parsed.host.toLowerCase() !== host.toLowerCase() ||
        parsed.pathname !== '/' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        throw new TypeError('approvedHosts must contain exact normalized URL.host values');
      }
      return host.toLowerCase();
    }),
  );
  return (input: string, base?: string): URL => {
    let url: URL;
    try {
      url = new URL(input, base);
    } catch {
      throw new PolicyError('invalid-url', 'URL cannot be resolved');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new PolicyError('policy', 'Only HTTP and HTTPS are allowed');
    }
    if (url.username || url.password) {
      throw new PolicyError('policy', 'Embedded credentials are forbidden');
    }
    if (!allowed.has(url.host.toLowerCase())) {
      throw new PolicyError('policy', 'Host is not explicitly approved');
    }
    url.hash = '';
    return url;
  };
}
export type UrlPolicy = ReturnType<typeof createUrlPolicy>;
