/**
 * Shared HTTP helper for source adapters: timeouts, retries with backoff,
 * polite rate limiting, and a real User-Agent.
 */

const USER_AGENT =
  process.env.INTERNINDEX_USER_AGENT ??
  // The repo URL stays as-is, because the GitHub repository has not been renamed and a
  // contact URL in a User-Agent is only useful if it actually resolves.
  'InternIndex/1.0 (self-hosted internship aggregator; +https://github.com/PranavG5/internfinder)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Treat these statuses as "empty result" rather than an error. */
  tolerate?: number[];
  /** JSON body to POST. Omit for a GET. */
  body?: unknown;
  /** Form-encoded body to POST, for APIs that predate JSON request bodies. */
  form?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-host serialization + minimum gap, so we never hammer one provider. */
const hostQueues = new Map<string, Promise<unknown>>();
const MIN_GAP_MS = Number(process.env.INTERNINDEX_MIN_GAP_MS ?? 120);

/**
 * Workday rate-limits per data center, not per tenant: every
 * `{tenant}.wd1.myworkdayjobs.com` shares one budget, and reading several
 * tenants at once answered HTTP 429 on every one of them. Those hosts share a
 * queue per data center with a wider gap.
 */
const WORKDAY_GAP_MS = Number(process.env.INTERNINDEX_WORKDAY_GAP_MS ?? 150);

export function queueKey(host: string): { key: string; gap: number } {
  const workday = /(?:^|\.)(wd\d+\.myworkdayjobs\.com)$/i.exec(host);
  if (workday) return { key: workday[1].toLowerCase(), gap: WORKDAY_GAP_MS };
  return { key: host, gap: MIN_GAP_MS };
}

function withHostQueue<T>(url: string, task: () => Promise<T>): Promise<T> {
  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    /* keep default */
  }
  const { key, gap } = queueKey(host);
  const prior = hostQueues.get(key) ?? Promise.resolve();
  const run = prior.then(async () => {
    const result = await task();
    await sleep(gap);
    return result;
  });
  // Keep the chain alive even if this task rejects.
  hostQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** Hosts that reject Node's fetch client and are requested through node:https instead. */
const NODE_HTTPS_HOSTS = /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com)$/i;

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** A minimal fetch over node:https that returns a standard Response. Follows up to 5 redirects. */
async function httpsRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
  redirects = 5,
): Promise<Response> {
  const https = await import('node:https');
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(url, { method: init.method, headers: init.headers, signal: init.signal }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects > 0) {
        res.resume();
        httpsRequest(new URL(location, url).toString(), { ...init, method: 'GET', body: undefined }, redirects - 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        // A 1xx/204/304 response may not carry a body in the Response constructor.
        const empty = status === 204 || status === 304 || status < 200;
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status: status || 500, headers }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function fetchOnce(url: string, opts: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  const isPost = opts.body !== undefined || opts.form !== undefined;
  const body = opts.form
    ? new URLSearchParams(opts.form).toString()
    : opts.body === undefined
      ? undefined
      : JSON.stringify(opts.body);
  const contentType = opts.form
    ? 'application/x-www-form-urlencoded; charset=UTF-8'
    : 'application/json';

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(isPost ? { 'Content-Type': contentType } : {}),
    ...opts.headers,
  };

  // Workday answers HTTP 429 to every request from Node's built-in fetch
  // (undici), whatever the headers, while the same request through node:https
  // succeeds. It fingerprints the client, so Workday hosts get the classic
  // transport. This, not rate limiting, is what made Workday boards fail.
  if (NODE_HTTPS_HOSTS.test(safeHost(url))) {
    try {
      return await httpsRequest(url, { method: isPost ? 'POST' : 'GET', headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      method: isPost ? 'POST' : 'GET',
      body,
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** GET a URL and parse JSON, retrying transient failures. */
export async function getJson<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const retries = opts.retries ?? 3;
  const tolerate = new Set(opts.tolerate ?? [404, 403, 410]);

  return withHostQueue(url, async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchOnce(url, opts);

        if (tolerate.has(res.status)) return null;

        // Back off and retry on rate limits and server errors.
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 20_000)
            : 800 * 2 ** attempt;
          lastError = new HttpError(`HTTP ${res.status}`, res.status, url);
          if (attempt < retries) {
            await sleep(waitMs);
            continue;
          }
          throw lastError;
        }

        if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, url);

        const text = await res.text();
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HttpError('Response was not valid JSON', res.status, url);
        }
      } catch (err) {
        lastError = err as Error;
        const isAbort = lastError.name === 'AbortError';
        const isNetwork = lastError.name === 'TypeError' || isAbort;
        if (attempt < retries && (isNetwork || lastError instanceof HttpError)) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${url}`);
  });
}

/** GET a URL and return the raw body. For feeds that publish XML rather than JSON. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const tolerate = new Set(opts.tolerate ?? [404, 403, 410]);

  return withHostQueue(url, async () => {
    const res = await fetchOnce(url, {
      ...opts,
      headers: { Accept: 'application/xml, text/xml, text/plain, */*', ...opts.headers },
    });
    if (tolerate.has(res.status)) return null;
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, url);
    return res.text();
  });
}

/**
 * POST a JSON body and parse the JSON response.
 *
 * Several of the biggest ATS APIs (Workday above all) only answer to POST, and
 * they get the same queueing, retry and timeout treatment as everything else.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts: FetchOptions = {},
): Promise<T | null> {
  return getJson<T>(url, { ...opts, body });
}

/**
 * POST a form-encoded body and parse the JSON response.
 *
 * Older server-rendered catalogs (the federal research portals in particular)
 * answer only to `application/x-www-form-urlencoded`, so they need this rather
 * than a JSON body.
 */
export async function postForm<T>(
  url: string,
  form: Record<string, string>,
  opts: FetchOptions = {},
): Promise<T | null> {
  return getJson<T>(url, { ...opts, form });
}

/**
 * Check whether an application link is still live.
 * Returns the HTTP status, plus whether the page says the role has closed.
 */
export async function checkLink(
  url: string,
  timeoutMs = 15_000,
): Promise<{ status: number; closed: boolean }> {
  const CLOSED_MARKERS = [
    /no longer accepting applications/i,
    /this (?:job|position|role|posting) (?:is|has been) (?:closed|filled|no longer available)/i,
    /position has been filled/i,
    /job posting (?:has expired|is closed)/i,
    /we are no longer accepting/i,
    /this requisition (?:is closed|has been closed)/i,
    /applications are closed/i,
    /job not found/i,
  ];

  return withHostQueue(url, async () => {
    try {
      const res = await fetchOnce(url, { timeoutMs, headers: { Accept: 'text/html,*/*' } });
      // Only "gone" statuses prove a posting closed. A 429 (rate limit), 403
      // (bot challenge) or 5xx says nothing about the role, and treating them
      // as closures used to delist live postings whenever a host throttled us.
      if (res.status === 404 || res.status === 410) return { status: res.status, closed: true };
      if (res.status >= 400) return { status: 0, closed: false };

      // Read a bounded prefix, enough to spot a "closed" banner without
      // downloading whole pages.
      const body = (await res.text()).slice(0, 60_000);
      const closed = CLOSED_MARKERS.some((re) => re.test(body));
      return { status: res.status, closed };
    } catch {
      return { status: 0, closed: false }; // network hiccup: don't judge the listing
    }
  });
}

/** Run tasks with bounded concurrency, preserving input order in the output. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
