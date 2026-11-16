import { decodeHtmlEntities, isEscapedHtml } from '../util';
import { fetchText, getJson } from './http';
import { robotsAllows } from './robots';
import { workdayBoardFromUrl } from './workday';

/**
 * Posting enrichment: turn a bare link into a full posting.
 *
 * The community lists and Hacker News give a title, company and link but no
 * description, so requirements, keywords, pay and eligibility can't be read.
 * This fetches the posting behind the link, preferring each ATS's official
 * per-job API, and otherwise reading the schema.org `JobPosting` JSON-LD that
 * Google for Jobs requires employers to embed (so almost every careers page
 * has it). Pages are only requested when robots.txt allows it.
 */

export interface Enrichment {
  description: string | null;
  title?: string | null;
  datePosted?: number | null;
  deadline?: number | null;
  locations?: string[];
  remote?: boolean | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  companyUrl?: string | null;
  /** Which method produced it, for logs and audits. */
  via: string;
}

const secs = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

function parts(url: string): { host: string; segments: string[]; u: URL } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), segments: u.pathname.split('/').filter(Boolean), u };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ATS APIs

async function greenhouse(token: string, id: string): Promise<Enrichment | null> {
  const job = await getJson<{
    content?: string;
    first_published?: string;
    updated_at?: string;
    location?: { name?: string };
    title?: string;
  }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}`, { retries: 1 });
  if (!job?.content) return null;
  const content = isEscapedHtml(job.content) ? decodeHtmlEntities(job.content) : job.content;
  return {
    description: content,
    title: job.title,
    datePosted: secs(job.first_published) ?? secs(job.updated_at),
    locations: job.location?.name ? [job.location.name] : undefined,
    via: 'greenhouse-api',
  };
}

async function lever(token: string, id: string): Promise<Enrichment | null> {
  const post = await getJson<{
    descriptionPlain?: string;
    additionalPlain?: string;
    lists?: { text?: string; content?: string }[];
    createdAt?: number;
    categories?: { location?: string; allLocations?: string[] };
    workplaceType?: string;
    salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  }>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}/${encodeURIComponent(id)}`, { retries: 1 });
  if (!post) return null;
  const lists = (post.lists ?? []).map((l) => `${l.text ?? ''}\n${l.content ?? ''}`).join('\n\n');
  const interval: Record<string, string> = { 'per-year-salary': 'year', 'per-month-salary': 'month', 'per-hour-wage': 'hour' };
  return {
    description: [post.descriptionPlain, lists, post.additionalPlain].filter(Boolean).join('\n\n') || null,
    datePosted: secs(post.createdAt ?? null),
    locations: post.categories?.allLocations ?? (post.categories?.location ? [post.categories.location] : undefined),
    remote: post.workplaceType ? /remote/i.test(post.workplaceType) : null,
    salaryMin: post.salaryRange?.min ?? null,
    salaryMax: post.salaryRange?.max ?? null,
    salaryPeriod: post.salaryRange?.interval ? interval[post.salaryRange.interval] ?? null : null,
    salaryCurrency: post.salaryRange?.currency ?? null,
    via: 'lever-api',
  };
}

const ashbyBoards = new Map<string, Promise<{ id: string; descriptionPlain?: string; publishedAt?: string }[]>>();
async function ashby(token: string, id: string): Promise<Enrichment | null> {
  let board = ashbyBoards.get(token);
  if (!board) {
    board = getJson<{ jobs?: { id: string; descriptionPlain?: string; publishedAt?: string }[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
      { retries: 1 },
    ).then((d) => d?.jobs ?? []);
    ashbyBoards.set(token, board);
  }
  const job = (await board).find((j) => j.id === id);
  return job?.descriptionPlain ? { description: job.descriptionPlain, datePosted: secs(job.publishedAt), via: 'ashby-api' } : null;
}

async function smartRecruiters(company: string, id: string): Promise<Enrichment | null> {
  const post = await getJson<{
    releasedDate?: string;
    jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
    location?: { city?: string; region?: string; country?: string; remote?: boolean };
  }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`, { retries: 1 });
  const sections = post?.jobAd?.sections;
  if (!sections) return null;
  const description = Object.values(sections)
    .map((s) => (s?.text ? `<h3>${s.title ?? ''}</h3>${s.text}` : ''))
    .join('\n');
  return {
    description: description || null,
    datePosted: secs(post?.releasedDate),
    remote: post?.location?.remote ?? null,
    via: 'smartrecruiters-api',
  };
}

async function workday(host: string, segments: string[]): Promise<Enrichment | null> {
  const board = workdayBoardFromUrl(host, segments);
  const jobIndex = segments.indexOf('job');
  if (!board || jobIndex < 0) return null;
  const path = segments.slice(jobIndex).join('/');
  const detail = await getJson<{
    jobPostingInfo?: { jobDescription?: string; postedOn?: string; startDate?: string; location?: string; additionalLocations?: string[]; remoteType?: string };
  }>(`https://${board.host}/wday/cxs/${board.tenant}/${board.site}/${path}`, { retries: 1, timeoutMs: 30_000 });
  const info = detail?.jobPostingInfo;
  if (!info?.jobDescription) return null;
  return {
    description: info.jobDescription,
    locations: [info.location, ...(info.additionalLocations ?? [])].filter(Boolean) as string[],
    remote: info.remoteType ? /remote/i.test(info.remoteType) : null,
    via: 'workday-api',
  };
}

// ---------------------------------------------------------------- JSON-LD

interface LdJobPosting {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  jobLocationType?: string;
  jobLocation?: LdPlace | LdPlace[];
  hiringOrganization?: { name?: string; sameAs?: string; url?: string } | string;
  baseSalary?: { currency?: string; value?: { minValue?: number | string; maxValue?: number | string; value?: number | string; unitText?: string } };
}
interface LdPlace {
  address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } | string;
}

const isPosting = (node: unknown): node is LdJobPosting => {
  if (!node || typeof node !== 'object') return false;
  const type = (node as LdJobPosting)['@type'];
  return Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting';
};

/** Find a schema.org JobPosting in a page's JSON-LD blocks, including inside @graph. */
export function extractJobPostingLd(html: string): LdJobPosting | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1].trim().replace(/^<!--|-->$/g, ''));
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === 'object') {
        if (isPosting(node)) return node;
        const graph = (node as { '@graph'?: unknown })['@graph'];
        if (graph) stack.push(graph);
      }
    }
  }
  return null;
}

const UNIT: Record<string, string> = { HOUR: 'hour', DAY: 'hour', WEEK: 'month', MONTH: 'month', YEAR: 'year' };

export function fromJsonLd(posting: LdJobPosting): Enrichment {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
  const locations = places
    .map((p) => {
      const a = p.address;
      if (!a) return null;
      if (typeof a === 'string') return a;
      const country = typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name;
      return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ') || null;
    })
    .filter(Boolean) as string[];
  const value = posting.baseSalary?.value;
  const num = (v: number | string | undefined) => {
    const n = typeof v === 'string' ? Number.parseFloat(v) : v;
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  const min = num(value?.minValue) ?? num(value?.value);
  const org = typeof posting.hiringOrganization === 'object' ? posting.hiringOrganization : null;
  return {
    description: posting.description ? decodeHtmlEntities(posting.description) : null,
    title: posting.title ?? null,
    datePosted: secs(posting.datePosted),
    deadline: secs(posting.validThrough),
    locations: locations.length ? locations : undefined,
    remote: posting.jobLocationType === 'TELECOMMUTE' ? true : null,
    salaryMin: min,
    salaryMax: num(value?.maxValue),
    salaryPeriod: min ? UNIT[(value?.unitText ?? '').toUpperCase()] ?? null : null,
    salaryCurrency: posting.baseSalary?.currency ?? null,
    companyUrl: org?.sameAs ?? org?.url ?? null,
    via: 'json-ld',
  };
}

async function jsonLd(url: string): Promise<Enrichment | null> {
  if (!(await robotsAllows(url))) return null;
  const html = await fetchText(url, { timeoutMs: 20_000, retries: 1, headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!html) return null;
  const posting = extractJobPostingLd(html.slice(0, 1_500_000));
  if (posting) return fromJsonLd(posting);
  // No structured data: the meta description is better than nothing for keywords.
  const meta = /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']{80,})["']/i.exec(html)?.[1];
  return meta ? { description: decodeHtmlEntities(meta), via: 'meta' } : null;
}

// ---------------------------------------------------------------- dispatch

/** Fetch the full posting behind an apply link. Null when nothing could be read. */
export async function enrichFromUrl(url: string): Promise<Enrichment | null> {
  const p = parts(url);
  if (!p) return null;
  const { host, segments, u } = p;
  try {
    if (host.endsWith('greenhouse.io')) {
      const jobs = segments.indexOf('jobs');
      if (segments[0] && jobs > 0 && segments[jobs + 1]) return (await greenhouse(segments[0], segments[jobs + 1])) ?? (await jsonLd(url));
      const ghJid = u.searchParams.get('gh_jid') ?? u.searchParams.get('token');
      const board = u.searchParams.get('for');
      if (ghJid && board) return greenhouse(board, ghJid);
    }
    if (host === 'jobs.lever.co' && segments.length >= 2) return lever(segments[0], segments[1]);
    if (host === 'jobs.ashbyhq.com' && segments.length >= 2) return ashby(segments[0], segments[1]);
    if (host === 'jobs.smartrecruiters.com' && segments.length >= 2) {
      const id = /^(\d{6,})/.exec(segments[1])?.[1];
      if (id) return smartRecruiters(segments[0], id);
    }
    if (/myworkdayjobs\.com$|myworkdaysite\.com$/.test(host)) return (await workday(host, segments)) ?? null;
    return await jsonLd(url);
  } catch {
    return null;
  }
}
