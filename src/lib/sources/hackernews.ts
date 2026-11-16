import type { RawListing } from '../parse';
import { decodeHtmlEntities } from '../util';
import { getJson } from './http';
import { boardFromUrl } from './seed';

/**
 * Hacker News "Ask HN: Who is hiring?" threads, read through the official
 * Algolia HN Search API (hn.algolia.com/api), not by scraping the site.
 *
 * Each monthly thread is a few hundred top-level comments, one per employer,
 * written free-form but almost always opening with a pipe-separated header:
 *
 *   Acme | Software Engineer Intern | Austin, TX or Remote | https://...
 *
 * Only comments that mention internships or co-ops are kept. The comment's
 * first link to a company ATS becomes the apply URL, so discovery registers
 * that employer's board and dedupe prefers the canonical ATS copy.
 */

interface HnHit {
  objectID: string;
  title?: string;
  created_at_i?: number;
}

interface HnItem {
  id: number;
  text?: string | null;
  author?: string | null;
  created_at_i?: number;
  children?: HnItem[];
}

/** Threads read per sync: this month's and last month's. */
const THREADS = 2;
const INTERN_RE = /\b(?:interns?|internships?|co-?ops?)\b/i;
const LOCATION_RE =
  /\b(?:remote|onsite|on-site|hybrid|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s?[A-Z]{2}\b|NYC|SF|Bay Area|London|Berlin|Toronto|Austin|Seattle|Boston|New York|San Francisco)/;

export async function fetchHackerNews(): Promise<RawListing[]> {
  const search = await getJson<{ hits?: HnHit[] }>(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=12',
  );
  const threads = (search?.hits ?? [])
    .filter((hit) => /who is hiring/i.test(hit.title ?? ''))
    .slice(0, THREADS);

  const listings: RawListing[] = [];
  for (const thread of threads) {
    const item = await getJson<HnItem>(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, {
      timeoutMs: 60_000,
    });
    for (const comment of item?.children ?? []) {
      const parsed = parseHiringComment(comment);
      if (parsed) listings.push(parsed);
    }
  }
  return listings;
}

/** Turn one "Who is hiring" comment into a listing, or null when it isn't about internships. */
export function parseHiringComment(comment: HnItem): RawListing | null {
  const html = comment.text ?? '';
  if (!html || !INTERN_RE.test(html)) return null;

  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeHtmlEntities(m[1]));
  const text = decodeHtmlEntities(
    html
      .replace(/<p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' '),
  ).trim();

  const header = text.split('\n')[0] ?? '';
  const parts = header.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null; // free-form comments carry no reliable company/title

  const company = parts[0].replace(/\(.*?\)/g, '').replace(/https?:\/\/\S+/g, '').trim();
  if (!company || company.length > 60) return null;

  const internPart = parts.find((p) => INTERN_RE.test(p));
  const sentence = text.split(/(?<=[.!?])\s/).find((s) => INTERN_RE.test(s));
  const title = (internPart ?? (sentence && sentence.length < 90 ? sentence : null) ?? 'Software Engineering Intern')
    .replace(/https?:\/\/\S+/g, '')
    .trim();

  const location = parts.slice(1).find((p) => p !== internPart && LOCATION_RE.test(p)) ?? null;
  const external = hrefs.filter((h) => /^https?:\/\//.test(h) && !/news\.ycombinator\.com/.test(h));
  const applyUrl =
    external.find((h) => boardFromUrl(h)) ??
    external.find((h) => /careers|jobs|apply|greenhouse|lever|ashby/i.test(h)) ??
    `https://news.ycombinator.com/item?id=${comment.id}`;

  return {
    source: 'hn',
    sourceKind: 'aggregator',
    sourceId: String(comment.id),
    company,
    title: INTERN_RE.test(title) ? title : `${title} (Intern)`,
    applyUrl,
    description: text,
    locations: location ? [location] : [],
    remoteFlag: /\bremote\b/i.test(header) ? true : null,
    terms: [],
    datePosted: comment.created_at_i ?? null,
    dateUpdated: comment.created_at_i ?? null,
    categoryHint: '',
    activeFlag: true,
    tags: ['hn:whos-hiring'],
  };
}
