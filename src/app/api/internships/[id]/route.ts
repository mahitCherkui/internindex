import { fail, handler, ok } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { getUserId } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { enrichRow, upsertListings } from '@/lib/sync';
import { toViews } from '@/lib/query';
import { getProfile } from '@/lib/repo';
import { buildBreakdown } from '@/lib/breakdown';
import type { Internship } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/internships/:id: one listing, with fit, tracker state and its requirements breakdown. */
export const GET = handler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (isDemo()) {
      const detail = await (await import('@/lib/demo')).demoDetail(id);
      return detail ? ok(detail) : fail('Internship not found', 404);
    }
    let row = await one<Internship>('SELECT * FROM internships WHERE id = ?', [id]);
    if (!row) return fail('Internship not found', 404);

    // Bare postings (community lists, Hacker News) get their full text fetched
    // the first time someone opens them, so the breakdown has something to read.
    const stale = !row.enriched_at || row.enriched_at < Math.floor(Date.now() / 1000) - 7 * 86_400;
    if ((!row.description || row.description.length < 200) && stale) {
      const result = await Promise.race([
        enrichRow(row),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]).catch(() => null);
      if (result) await upsertListings([result.listing]);
      await exec('UPDATE internships SET enriched_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000), id]);
      row = (await one<Internship>('SELECT * FROM internships WHERE id = ?', [id])) ?? row;
    }

    const userId = await getUserId();
    const profile = userId ? await getProfile(userId) : null;
    const [view] = await toViews([row], profile, userId);
    return ok({ ...view, breakdown: buildBreakdown(view, profile) });
  },
);
