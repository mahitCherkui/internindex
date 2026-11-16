import { q } from './db';
import { parseSearchParams, searchInternships } from './query';
import { getProfile, listSavedSearches } from './repo';
import type { InternshipView } from './types';

export interface DigestSection {
  searchId: number;
  name: string;
  query: string;
  total: number;
  rows: InternshipView[];
}

export interface Digest {
  generatedAt: number;
  /** New roles in the last 24 hours, per saved search with alerts on. */
  sections: DigestSection[];
  /** Shortlisted or tracked roles whose deadline is within 3 days. */
  closingSoon: { id: string; title: string; company: string; deadline: number; apply_url: string }[];
  seenAt: number | null;
}

/**
 * The daily digest: what's new for each saved search in the last 24 hours,
 * plus anything you saved or are tracking that closes in the next three days.
 * Shown in the app; it is cheap to compute, so it is built on request rather
 * than by a scheduled job.
 */
export async function buildDigest(userId: string): Promise<Digest> {
  const profile = await getProfile(userId);
  const searches = profile.digest_enabled === 0 ? [] : (await listSavedSearches(userId)).filter((s) => s.alert);
  const now = Math.floor(Date.now() / 1000);

  const sections = await Promise.all(
    searches.slice(0, 10).map(async (search): Promise<DigestSection> => {
      const query = parseSearchParams(new URLSearchParams(search.query_json));
      const result = await searchInternships(
        { ...query, newToday: true, page: 1, limit: 5, sort: profile ? 'match' : 'newest' },
        profile,
        userId,
      );
      return { searchId: search.id, name: search.name, query: search.query_json, total: result.total, rows: result.rows };
    }),
  );

  const closingSoon = await q<Digest['closingSoon'][number]>(
    `SELECT i.id, i.title, i.company, i.deadline, i.apply_url FROM internships i
     WHERE i.is_open = 1 AND i.deadline BETWEEN ? AND ?
       AND (i.id IN (SELECT internship_id FROM bookmarks WHERE user_id = ?)
         OR i.id IN (SELECT internship_id FROM applications WHERE user_id = ? AND internship_id IS NOT NULL
                     AND status IN ('interested', 'preparing')))
     ORDER BY i.deadline ASC LIMIT 10`,
    [now, now + 3 * 86_400, userId, userId],
  );

  return { generatedAt: now, sections: sections.filter((s) => s.total > 0), closingSoon, seenAt: profile.digest_seen_at ?? null };
}
