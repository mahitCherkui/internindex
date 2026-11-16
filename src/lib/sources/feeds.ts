import type { RawListing } from '../parse';
import { canonicalApplyUrl, decodeHtmlEntities } from '../util';
import { fetchText, getJson, mapPool } from './http';
import { markPartial } from './partial';

/**
 * Community-maintained and public job feeds.
 *
 * These give broad coverage across thousands of employers. Each carries its own
 * openness signal, which the pipeline respects:
 *   - the GitHub internship lists publish an `active` flag per listing
 *   - RemoteOK and Arbeitnow only serve currently-posted roles
 */

// -------------------------------------------------- GitHub internship lists

interface GithubListing {
  id: string;
  title: string;
  company_name: string;
  company_url?: string;
  url: string;
  locations?: string[];
  terms?: string[];
  season?: string;
  sponsorship?: string;
  degrees?: string[];
  category?: string;
  active?: boolean;
  is_visible?: boolean;
  date_posted?: number;
  date_updated?: number;
  source?: string;
}

type GithubFeed =
  | { format: 'simplify-json'; url: string; label: string }
  /**
   * A README of markdown tables (Company | Role | Location | … | Apply | Posted).
   * Each table's own header decides which column is which. `redirector` names
   * hosts whose links are tracking redirects to follow to the employer's page.
   */
  | { format: 'markdown-table'; url: string; label: string; redirector?: RegExp }
  /** Northwestern FinTech's quant list: one section per firm, then |Role|Links|. */
  | { format: 'firm-sections'; url: string; label: string };

/**
 * The community lists roll over every year (Summer2026 → Summer2027). Each
 * one carries off-season terms (Fall, Winter, Spring co-ops) alongside the
 * summer cycle in the same file, so there is no separate off-season feed to
 * read; the term is kept per listing.
 */
export const GITHUB_FEEDS: Record<string, GithubFeed> = {
  'simplify-summer': {
    format: 'simplify-json',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
    label: 'SimplifyJobs Summer 2027 (+ off-season)',
  },
  'vansh-summer': {
    format: 'simplify-json',
    url: 'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json',
    label: 'vanshb03 Summer 2027',
  },
  // New-grad postings are mostly not internships and get filtered out on the
  // way in, but the archives name thousands of employer job boards, and every
  // one they reveal is a board the discovery pass can crawl for internships.
  'simplify-newgrad': {
    format: 'simplify-json',
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
    label: 'SimplifyJobs New Grad',
  },
  'vansh-newgrad': {
    format: 'simplify-json',
    url: 'https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json',
    label: 'vanshb03 New Grad 2027',
  },
  'speedy-swe': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md',
    label: 'speedyapply 2027 SWE internships (USA)',
  },
  'speedy-swe-intl': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/INTERN_INTL.md',
    label: 'speedyapply 2027 SWE internships (international)',
  },
  'speedy-ai': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/README.md',
    label: 'speedyapply 2027 AI internships',
  },
  'zapply-intern': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/zapplyjobs/Internships-2027/main/README.md',
    label: 'zapplyjobs Internships 2027',
    redirector: /(?:^|\.)zapply\.jobs$/,
  },
  'zapply-ml': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/zapplyjobs/awesome-ml-internships-2027/main/README.md',
    label: 'zapplyjobs ML internships 2027',
    redirector: /(?:^|\.)zapply\.jobs$/,
  },
  'nwf-quant': {
    format: 'firm-sections',
    url: 'https://raw.githubusercontent.com/northwesternfintech/2027QuantInternships/main/README.md',
    label: 'Northwestern FinTech 2027 Quant Internships',
  },
  'canada-2027': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/main/README.md',
    label: 'Canadian Tech Internships 2027',
  },
  'jobbie-2027': {
    format: 'markdown-table',
    url: 'https://raw.githubusercontent.com/jobbie-bot/Summer-2027-Tech-Internships/main/README.md',
    label: 'jobbie Summer 2027 Tech Internships',
  },
};

export { canonicalApplyUrl } from '../util';

export async function fetchGithubList(token: string): Promise<RawListing[]> {
  const feed = GITHUB_FEEDS[token];
  if (!feed) return [];
  if (feed.format === 'markdown-table' || feed.format === 'firm-sections') {
    const text = await fetchText(feed.url, { timeoutMs: 60_000 });
    if (!text) return [];
    const rows = feed.format === 'firm-sections' ? parseFirmSections(text, `github:${token}`) : parseMarkdownJobTable(text, `github:${token}`);
    return feed.format === 'markdown-table' && feed.redirector ? resolveRedirects(rows, feed.redirector) : rows;
  }

  const data = await getJson<GithubListing[]>(feed.url, { timeoutMs: 90_000 });
  if (!Array.isArray(data)) return [];

  return data
    // Hidden entries are editorial removals; drop them outright.
    .filter((item) => item.is_visible !== false && item.url && item.title && item.company_name)
    .map((item) => {
      const terms = item.terms?.length ? item.terms : item.season ? [item.season] : [];
      return {
        source: `github:${token}`,
        sourceKind: 'aggregator',
        sourceId: item.id,
        company: item.company_name,
        companyUrl: item.company_url || null,
        title: item.title,
        applyUrl: canonicalApplyUrl(item.url),
        description: null, // these feeds are metadata-only
        locations: item.locations ?? [],
        terms: terms.filter((t) => t && t !== 'N/A'),
        datePosted: item.date_posted ?? null,
        dateUpdated: item.date_updated ?? item.date_posted ?? null,
        categoryHint: item.category ?? '',
        sponsorshipHint: item.sponsorship ?? null,
        degreeHints: item.degrees ?? [],
        // The feed's own flag is authoritative: false means delisted upstream.
        activeFlag: item.active !== false,
      } satisfies RawListing;
    });
}

/**
 * Read the speedyapply-style README tables. Rows look like
 *
 *   | <a href="…"><strong>Meta</strong></a> | Research Intern | Burlingame, CA | $50/hr | <a href="APPLY">…</a> | 5d |
 *
 * The age column ("5d", "3h", "2mo") is converted back to a posting date.
 */
export function parseMarkdownJobTable(markdown: string, source: string, now = Date.now()): RawListing[] {
  const out: RawListing[] = [];
  const cellText = (cell: string) =>
    decodeHtmlEntities(cell.replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
  const split = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim());
  // Tables differ in columns (the international one has no Salary), so each
  // table's header decides which cell is which.
  let columns: Record<string, number> | null = null;
  let lastCompany = '';
  let lastCompanyUrl: string | null = null;

  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (/^\|\s*:?-{3}/.test(line)) continue;
    const cells = split(line);
    if (/^\|\s*Company\s*\|/i.test(line)) {
      columns = {};
      cells.forEach((name, i) => {
        const key = cellText(name).toLowerCase();
        if (/company|employer|firm/.test(key)) columns!.company = i;
        else if (/position|role|title/.test(key)) columns!.title = i;
        else if (/location/.test(key)) columns!.location = i;
        else if (/salary|pay/.test(key)) columns!.salary = i;
        else if (/visa|h-?1b|sponsor/.test(key)) columns!.visa = i;
        // "Apply with <product>" columns link to a third-party flow, not the posting.
        else if (/posting|apply|link/.test(key) && !/\bwith\b/.test(key) && columns!.link == null) columns!.link = i;
        else if (/age|posted|date/.test(key)) columns!.age = i;
      });
      continue;
    }
    if (!columns || columns.company == null || columns.title == null || columns.link == null) continue;

    let company = cellText(cells[columns.company] ?? '');
    // The company cell links the employer's homepage, which is the best logo source there is.
    let companyUrl = linkIn(cells[columns.company] ?? '');
    if (companyUrl && /swejoblists|simplify\.jobs|zapply|jobbie|github\.com/.test(companyUrl)) companyUrl = null;
    if (company === '↳' || !company) {
      company = lastCompany;
      companyUrl = lastCompanyUrl;
    }
    lastCompany = company;
    lastCompanyUrl = companyUrl;
    const title = cellText(cells[columns.title] ?? '');
    const linkCell = cells[columns.link] ?? '';
    const href = linkIn(linkCell);
    if (!company || !title || !href) continue;

    const posted = columns.age != null ? parseAge(cellText(cells[columns.age] ?? ''), now) : null;
    const visa = columns.visa != null ? cellText(cells[columns.visa] ?? '') : '';

    const salary = columns.salary != null ? cellText(cells[columns.salary] ?? '') : '';
    const pay = /\$\s?([\d,.]+)\s*\/\s*(hr|hour|mo|month|yr|year)/i.exec(salary);
    const periods: Record<string, string> = { hr: 'hour', hour: 'hour', mo: 'month', month: 'month', yr: 'year', year: 'year' };

    const applyUrl = canonicalApplyUrl(decodeHtmlEntities(href));
    out.push({
      source,
      sourceKind: 'aggregator',
      sourceId: applyUrl,
      company,
      companyUrl,
      title,
      applyUrl,
      description: null,
      locations: columns.location != null
        ? cellText(cells[columns.location] ?? '').split(/\s*;\s*/).map((l) => l.replace(/\s*\+\d+$/, '')).filter(Boolean)
        : [],
      terms: [],
      datePosted: posted,
      dateUpdated: posted,
      categoryHint: '',
      salaryMin: pay ? Number.parseFloat(pay[1].replace(/,/g, '')) : null,
      salaryMax: null,
      salaryPeriod: pay ? periods[pay[2].toLowerCase()] ?? null : null,
      salaryCurrency: pay ? 'USD' : null,
      // "✅ Sponsor" / "🟢 Yes" style columns; "Likely" is not a promise, so it stays unknown.
      sponsorshipHint: /sponsor|yes|✅|🟢/i.test(visa) && !/no\b|❌|likely/i.test(visa) ? 'Offers Sponsorship' : /no\b|❌/i.test(visa) ? 'Does Not Offer Sponsorship' : null,
      activeFlag: true,
    });
  }
  return out;
}

/** First link in a cell: an HTML href or a markdown [text](url). */
function linkIn(cell: string): string | null {
  return /href="([^"]+)"/.exec(cell)?.[1] ?? /\]\((https?:[^)\s]+)\)/.exec(cell)?.[1] ?? /\((https?:[^)\s]+)\)/.exec(cell)?.[1] ?? null;
}

/** "12m", "3h", "5d", "2w", "2mo", or a date like "2026-11-15" / "Nov 13, 2026". */
export function parseAge(text: string, now = Date.now()): number | null {
  const rel = /^(\d+)\s*(m(?!o)|min|h|d|w|mo|y)/i.exec(text.trim());
  if (rel) {
    const unit = rel[2].toLowerCase();
    const days: Record<string, number> = { m: 1 / 1440, min: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 30, y: 365 };
    return Math.floor((now - Number(rel[1]) * days[unit] * 86_400_000) / 1000);
  }
  const t = Date.parse(text.trim());
  return Number.isFinite(t) && t <= now + 86_400_000 ? Math.floor(t / 1000) : null;
}

const QUANT_ROLES: Record<string, string> = {
  QR: 'Quantitative Research',
  QT: 'Quantitative Trading',
  QD: 'Quantitative Developer',
  SWE: 'Software Engineering',
  DS: 'Data Science',
  ML: 'Machine Learning',
  RA: 'Research Analyst',
  OPS: 'Trading Operations',
};

/**
 * Northwestern FinTech's list: a "## Firm" heading, a **Website** line, then a
 * |Role|Links| table whose link cells hold one or more [✅ variant](url).
 */
export function parseFirmSections(markdown: string, source: string): RawListing[] {
  const out: RawListing[] = [];
  let firm = '';
  let website: string | null = null;
  let locations: string[] = [];
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      firm = /contributing|using this/i.test(heading[1]) ? '' : heading[1].trim();
      website = null;
      locations = [];
      continue;
    }
    if (!firm) continue;
    const site = /^\*\*Website\*\*:\s*\[[^\]]*\]\(([^)]+)\)/.exec(line);
    if (site) website = site[1];
    const where = /^\*\*Locations?\*\*:\s*(.+)$/.exec(line);
    if (where) locations = where[1].split(/[,;/]/).map((l) => l.trim()).filter(Boolean);
    if (!line.startsWith('|') || /^\|\s*-|^\|\s*Role\s*\|/i.test(line)) continue;
    const [roleCell = '', linksCell = ''] = line.split('|').slice(1, -1);
    const code = cellTextPlain(roleCell).toUpperCase();
    const role = QUANT_ROLES[code] ?? cellTextPlain(roleCell);
    for (const m of linksCell.matchAll(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g)) {
      // ✅ marks an open application; ❌ or 🔒 mark closed ones.
      if (/❌|🔒|closed/i.test(m[1])) continue;
      const variant = m[1].replace(/✅/g, '').trim();
      const applyUrl = canonicalApplyUrl(m[2]);
      out.push({
        source,
        sourceKind: 'aggregator',
        sourceId: applyUrl,
        company: firm,
        companyUrl: website,
        title: `${role} Intern${variant ? ` (${variant})` : ''}`,
        applyUrl,
        description: null,
        locations,
        terms: ['Summer 2027'],
        datePosted: null,
        dateUpdated: null,
        categoryHint: 'Quant',
        activeFlag: true,
      });
    }
  }
  return out;
}

function cellTextPlain(cell: string): string {
  return decodeHtmlEntities(cell.replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
}

/**
 * Follow tracking redirects (e.g. zapply.jobs/l/d/…) to the employer's own
 * posting, so the stored link is the real application page and discovery can
 * register the board. Only the redirect header is read, never the page; at
 * most 300 per run, and an unresolved link is kept as it was.
 */
async function resolveRedirects(rows: RawListing[], redirector: RegExp): Promise<RawListing[]> {
  const pending = rows.filter((r) => {
    try {
      return redirector.test(new URL(r.applyUrl).hostname);
    } catch {
      return false;
    }
  });
  const budget = pending.slice(0, 300);
  await mapPool(budget, 4, async (row) => {
    const target = await finalLocation(row.applyUrl);
    if (target) row.applyUrl = canonicalApplyUrl(target);
  });
  return rows;
}

async function finalLocation(url: string): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    try {
      const res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'InternIndex/1.0 (+https://github.com/PranavG5/internfinder)' } });
      const next = res.headers.get('location');
      void res.body?.cancel();
      if (res.status < 300 || res.status >= 400 || !next) return hop === 0 ? null : current;
      current = new URL(next, current).toString();
      // Stop as soon as we leave the redirector.
      if (!/zapply\.jobs/.test(new URL(current).hostname)) return current;
    } catch {
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------ RemoteOK

interface RemoteOkJob {
  id?: string;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
}

export async function fetchRemoteOk(): Promise<RawListing[]> {
  const data = await getJson<RemoteOkJob[]>('https://remoteok.com/api');
  if (!Array.isArray(data)) return [];

  return data
    // The first element of this feed is a legal/attribution notice, not a job.
    .filter((job) => job.id && job.position && job.company)
    .map((job): RawListing => ({
      source: 'remoteok',
      sourceKind: 'board',
      sourceId: String(job.id),
      company: decodeHtmlEntities(job.company ?? ''),
      title: decodeHtmlEntities(job.position ?? ''),
      applyUrl: job.apply_url || job.url || `https://remoteok.com/remote-jobs/${job.slug}`,
      description: job.description ?? null,
      locations: job.location ? [job.location] : ['Remote'],
      remoteFlag: true,
      terms: [],
      datePosted: job.epoch ?? (job.date ? Math.floor(Date.parse(job.date) / 1000) : null),
      dateUpdated: job.epoch ?? null,
      categoryHint: (job.tags ?? []).slice(0, 6).join(', '),
      // RemoteOK quotes annual USD figures.
      salaryMin: job.salary_min ?? null,
      salaryMax: job.salary_max ?? null,
      salaryPeriod: job.salary_min ? 'year' : null,
      salaryCurrency: 'USD',
      activeFlag: true,
      tags: (job.tags ?? []).slice(0, 8),
    }))
    .filter((l) => l.applyUrl && l.company && l.title);
}

// -------------------------------------------------------------------- Jobicy

interface JobicyJob {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  companyLogo?: string;
  jobIndustry?: string[] | string;
  jobType?: string[] | string;
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

export async function fetchJobicy(): Promise<RawListing[]> {
  // Jobicy caps count at 100; the internship tag keeps the feed on-topic.
  const data = await getJson<{ jobs?: JobicyJob[] }>(
    'https://jobicy.com/api/v2/remote-jobs?count=100&tag=intern',
  );
  const jobs = data?.jobs ?? [];

  return jobs
    .filter((job) => job.id && job.jobTitle && job.companyName && job.url)
    .map((job): RawListing => {
      const asList = (v: string[] | string | undefined): string[] =>
        Array.isArray(v) ? v : v ? [v] : [];
      return {
        source: 'jobicy',
        sourceKind: 'board',
        sourceId: String(job.id),
        company: decodeHtmlEntities(job.companyName ?? ''),
        title: decodeHtmlEntities(job.jobTitle ?? ''),
        applyUrl: job.url ?? '',
        description: job.jobDescription ?? job.jobExcerpt ?? null,
        locations: job.jobGeo ? [job.jobGeo] : ['Remote'],
        remoteFlag: true,
        terms: [],
        datePosted: job.pubDate ? Math.floor(Date.parse(job.pubDate) / 1000) || null : null,
        dateUpdated: null,
        categoryHint: [...asList(job.jobIndustry), ...asList(job.jobType)].slice(0, 6).join(', '),
        salaryMin: job.annualSalaryMin ?? null,
        salaryMax: job.annualSalaryMax ?? null,
        salaryPeriod: job.annualSalaryMin ? 'year' : null,
        salaryCurrency: job.salaryCurrency ?? 'USD',
        activeFlag: true,
        tags: asList(job.jobType).slice(0, 6),
      };
    });
}

// ---------------------------------------------------------------- The Muse

interface MuseJob {
  id?: number;
  name?: string;
  contents?: string;
  publication_date?: string;
  type?: string;
  short_name?: string;
  company?: { name?: string; short_name?: string };
  locations?: { name?: string }[];
  categories?: { name?: string }[];
  levels?: { name?: string; short_name?: string }[];
  tags?: { name?: string; short_name?: string }[];
  refs?: { landing_page?: string };
}

/**
 * The Muse indexes employers that the ATS crawlers never reach: hospital
 * systems, health insurers, clinics, school districts and government agencies
 * post here even when their own careers site is a closed portal. It is also
 * one of the few places banks, insurers, retailers and consumer brands list
 * their business analyst, analytics and insights internships.
 *
 * Any single query stops at 99 pages, and the internship catalog runs to
 * about 10,000 postings, so it is read category by category. The business
 * categories go first, since no ATS crawl reaches most of their employers.
 * A category longer than the page cap is read from both ends.
 */
const MUSE_CATEGORIES = [
  // Business analytics, finance and operations.
  'Data and Analytics',
  'Business Operations',
  'Accounting and Finance',
  'Management',
  'Project Management',
  'Product Management',
  'Sales',
  'Account Management',
  'Advertising and Marketing',
  'Human Resources and Recruitment',
  'Transportation and Logistics',
  // Healthcare, science and education, which the catalog already leaned on.
  'Healthcare',
  'Science and Engineering',
  'Education',
  // Everything else with a meaningful internship count.
  'Software Engineering',
  'Design and UX',
  'Legal Services',
  'Computer and IT',
  'Administration and Office',
  'Media, PR, and Communications',
  'Food and Hospitality Services',
  'Manufacturing and Warehouse',
];

/** The API serves 20 per page and stops at page 99. */
const MUSE_MAX_PAGES = 99;

/**
 * Requests per sync. Anonymous callers get 500 an hour, so the default leaves
 * headroom for retries; a free key (MUSE_API_KEY) raises the limit to 3,600.
 */
const MUSE_BUDGET = process.env.MUSE_API_KEY ? 3000 : 450;

/**
 * Muse keeps internships listed long after they were posted, and about two
 * thirds of its catalog is older than the lifecycle sweep's 150-day "posted
 * long ago, never updated" cutoff (Muse never reports an update date). Those
 * would be written only to be closed in the same run and then kept for a
 * month, which on a 500 MB database is space the live catalog needs.
 */
const MUSE_MAX_AGE_DAYS = 150;

export async function fetchMuse(opts: { budget?: number } = {}): Promise<RawListing[]> {
  const budget = Math.min(opts.budget ?? MUSE_BUDGET, MUSE_BUDGET);
  const found = new Map<number, MuseJob>();
  const key = process.env.MUSE_API_KEY;
  let requests = 0;
  /** Requests that came back with a JSON body (a 403 challenge page does not). */
  let answered = 0;
  /** Whether anything was left unread, which makes the result a partial view. */
  let truncated = false;

  const read = async (category: string | null, descending: boolean, maxPages: number) => {
    let pageCount = 0;
    for (let page = 0; page < maxPages; page++) {
      if (requests >= budget) {
        truncated = true;
        return pageCount;
      }
      requests++;
      const url =
        `https://www.themuse.com/api/public/jobs?page=${page}&level=Internship` +
        (category ? `&category=${encodeURIComponent(category)}` : '') +
        (descending ? '&descending=true' : '') +
        (key ? `&api_key=${encodeURIComponent(key)}` : '');

      // A page past the end answers 400, which means "done", not "broken".
      const data = await getJson<{ results?: MuseJob[]; page_count?: number }>(url, {
        timeoutMs: 30_000,
        tolerate: [400, 403, 404],
      });
      if (data) answered++;
      const batch = data?.results ?? [];
      for (const job of batch) if (job.id) found.set(job.id, job);
      pageCount = data?.page_count ?? 0;
      if (batch.length === 0 || page + 1 >= pageCount) return pageCount;
    }
    return pageCount;
  };

  for (const category of MUSE_CATEGORIES) {
    const pages = await read(category, false, MUSE_MAX_PAGES);
    if (pages > MUSE_MAX_PAGES) {
      // Too long for one pass, so come at it from the other end too.
      await read(category, true, Math.min(MUSE_MAX_PAGES, pages - MUSE_MAX_PAGES));
      if (pages > 2 * MUSE_MAX_PAGES) truncated = true;
    }
  }

  // Some postings carry no category at all. The uncategorized remainder is
  // only reachable through the unfiltered query, which is far longer than one
  // pass, so whatever budget is left goes there and the result is partial.
  const total = await read(null, false, MUSE_MAX_PAGES);
  if (total > MUSE_MAX_PAGES) {
    await read(null, true, MUSE_MAX_PAGES);
    truncated = true;
  }

  // Every request refused means the API is unreachable (since late 2026 it
  // sits behind a Cloudflare bot challenge that answers 403), not that every
  // internship closed. Failing here keeps reconciliation from delisting the
  // whole Muse catalog; the unseen sweep retires it gradually instead.
  if (requests > 0 && answered === 0) {
    throw new Error('The Muse API refused every request (HTTP 403 bot challenge)');
  }

  const oldest = Date.now() - MUSE_MAX_AGE_DAYS * 86_400_000;
  const listings = [...found.values()]
    .filter((job) => !job.publication_date || Date.parse(job.publication_date) >= oldest)
    .map((job): RawListing => ({
      source: 'muse',
      sourceKind: 'aggregator',
      sourceId: String(job.id),
      company: decodeHtmlEntities(job.company?.name ?? ''),
      title: decodeHtmlEntities(job.name ?? ''),
      applyUrl: job.refs?.landing_page ?? '',
      description: job.contents ?? null,
      locations: (job.locations ?? []).map((l) => l.name).filter(Boolean) as string[],
      terms: [],
      datePosted: job.publication_date ? Math.floor(Date.parse(job.publication_date) / 1000) || null : null,
      dateUpdated: null,
      categoryHint: (job.categories ?? []).map((c) => c.name).filter(Boolean).join(', '),
      activeFlag: true,
      tags: (job.tags ?? []).map((t) => t.name).filter(Boolean).slice(0, 6) as string[],
    }))
    .filter((l) => l.applyUrl && l.company && l.title);

  return truncated ? markPartial(listings) : listings;
}

// ----------------------------------------------------------------- Arbeitnow

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

export async function fetchArbeitnow(): Promise<RawListing[]> {
  const collected: ArbeitnowJob[] = [];

  // Paginate deep; the feed is ordered newest-first and Europe posts steadily.
  for (let page = 1; page <= 12; page++) {
    const data = await getJson<{ data?: ArbeitnowJob[] }>(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
    );
    const batch = data?.data ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);
  }

  return collected
    .filter((job) => job.slug && job.title && job.company_name)
    .map((job): RawListing => ({
      source: 'arbeitnow',
      sourceKind: 'board',
      sourceId: job.slug,
      company: job.company_name,
      title: job.title,
      applyUrl: job.url || `https://www.arbeitnow.com/jobs/${job.slug}`,
      description: job.description ?? null,
      locations: job.location ? [job.location] : [],
      remoteFlag: job.remote ?? null,
      terms: [],
      datePosted: job.created_at ?? null,
      dateUpdated: job.created_at ?? null,
      categoryHint: (job.tags ?? []).slice(0, 6).join(', '),
      activeFlag: true,
      tags: (job.job_types ?? []).slice(0, 6),
    }));
}
