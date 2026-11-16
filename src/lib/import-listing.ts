import { exec, nowSec, one } from './db';
import { normalize, type RawListing } from './parse';
import { fetchSourceRaw } from './sources/registry';
import { boardFromUrl } from './sources/seed';
import { discoverBoards, upsertListings } from './sync';
import { canonicalApplyUrl, hashId, parseCsv } from './util';
import { NO_FETCH_HOSTS } from './no-fetch';

export { NO_FETCH_HOSTS };

/**
 * Bring a posting in by hand, for the sources this app deliberately does not
 * crawl: LinkedIn, Handshake, Indeed, Glassdoor, Jobright, Wellfound, Built In,
 * Levels.fyi, Otta, RippleMatch, Dice and the like, whose terms forbid
 * automated access or which sit behind a login.
 *
 * Nothing here ever requests one of those sites. Two paths:
 *
 *  1. The pasted URL, or any link inside the pasted text, points at a company
 *     ATS this app reads (Greenhouse, Lever, Workday, …). The employer's own
 *     board is fetched through its official API, registered for future syncs,
 *     and the matching posting is stored as the canonical copy.
 *  2. Otherwise the pasted posting text is parsed exactly like a crawled
 *     description, and the URL is kept as the apply link.
 */

export interface ImportInput {
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  text?: string;
}

export interface ImportOutcome {
  id: string | null;
  via: 'ats' | 'pasted' | 'skipped';
  message: string;
  boardAdded?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Every http(s) link in a blob of pasted text, in order. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0].replace(/[.,;]+$/, ''));
}

/** Does a crawled posting correspond to the URL the user pasted? */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => canonicalApplyUrl(u).replace(/\/(?:apply|application)\/?$/i, '').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a));
}

export async function importListing(userId: string, input: ImportInput): Promise<ImportOutcome> {
  const url = (input.url ?? '').trim();
  const text = (input.text ?? '').trim();

  // ---- Path 1: an employer ATS link, in the URL field or the pasted text. ----
  const candidates = [url, ...linksIn(text)].filter(Boolean);
  const atsUrl = candidates.find((u) => !NO_FETCH_HOSTS.test(hostOf(u)) && boardFromUrl(u));
  if (atsUrl) {
    const board = boardFromUrl(atsUrl)!;
    const label = input.company?.trim() || board.label;
    const added = await discoverBoards([{ url: atsUrl, company: input.company?.trim() || undefined }]);
    try {
      const raw = await fetchSourceRaw(board.kind, board.token, label);
      const match = raw.find((r) => sameUrl(r.applyUrl, atsUrl));
      if (match) {
        const listing = normalize({ ...match, assumeInternship: true });
        if (listing) {
          await upsertListings([listing]);
          await bookmark(userId, listing.id);
          return {
            id: listing.id,
            via: 'ats',
            message: `Imported from ${label}'s own job board.`,
            boardAdded: added ? `${board.kind}:${board.token}` : undefined,
          };
        }
      }
    } catch {
      // Fall through to the pasted text; the board stays registered for the sync.
    }
  }

  // ---- Path 2: parse what was pasted. ----
  const title = input.title?.trim() || guessTitle(text);
  const company = input.company?.trim() || '';
  if (!title || !company) {
    return {
      id: null,
      via: 'skipped',
      message: 'Add the role title and company (and paste the posting text) so it can be parsed.',
    };
  }
  const applyUrl = atsUrl || url || candidates[0] || '';
  if (!applyUrl) {
    return { id: null, via: 'skipped', message: 'Add the posting URL so the Apply button has somewhere to go.' };
  }

  const raw: RawListing = {
    source: 'import',
    sourceKind: 'board',
    sourceId: hashId(canonicalApplyUrl(applyUrl), `${company}|${title}`),
    company,
    title,
    applyUrl,
    description: text || null,
    locations: input.location ? [input.location] : [],
    terms: [],
    datePosted: nowSec(),
    dateUpdated: nowSec(),
    activeFlag: true,
    assumeInternship: true,
    tags: [`imported-from:${hostOf(applyUrl) || 'unknown'}`],
  };
  const listing = normalize(raw);
  if (!listing) return { id: null, via: 'skipped', message: 'That posting could not be parsed.' };
  await upsertListings([listing]);
  await bookmark(userId, listing.id);
  return { id: listing.id, via: 'pasted', message: `Imported ${title} at ${company} from the pasted text.` };
}

/** First short line that reads like a job title. */
function guessTitle(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3 && l.length < 120 && /intern|co-?op|engineer|analyst|scientist|developer|research/i.test(l));
  return line ?? '';
}

async function bookmark(userId: string, internshipId: string): Promise<void> {
  const exists = await one('SELECT 1 FROM bookmarks WHERE user_id = ? AND internship_id = ?', [userId, internshipId]);
  if (!exists) {
    await exec('INSERT INTO bookmarks (user_id, internship_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [
      userId,
      internshipId,
      nowSec(),
    ]);
  }
}

/**
 * Parse a saved-jobs export (CSV from Jobright, Simplify, LinkedIn "My Jobs"
 * copied into a sheet, …). Column names are matched loosely: anything with
 * "title"/"position"/"role", "company"/"employer", "url"/"link", "location".
 */
export function parseSavedJobsCsv(csv: string): ImportInput[] {
  const records = parseCsv(csv);
  if (records.length === 0) return [];
  const headers = Object.keys(records[0]);
  const col = (re: RegExp) => headers.find((h) => re.test(h.toLowerCase().trim()));
  const kTitle = col(/title|position|role|job\s*name/);
  const kCompany = col(/company|employer|organi[sz]ation/);
  const kUrl = col(/url|link|apply/);
  const kLocation = col(/location|city/);
  const kDesc = col(/description|details|notes/);
  if (!kTitle || !kCompany) return [];

  return records
    .map((r) => ({
      title: r[kTitle]?.trim(),
      company: r[kCompany]?.trim(),
      url: kUrl ? r[kUrl]?.trim() : undefined,
      location: kLocation ? r[kLocation]?.trim() : undefined,
      text: kDesc ? r[kDesc]?.trim() : undefined,
    }))
    .filter((r) => r.title && r.company);
}
