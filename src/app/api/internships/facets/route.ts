import { handler, ok } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { getUserId } from '@/lib/auth';
import { computeFacets, parseSearchParams } from '@/lib/query';
import { getProfile } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/internships/facets: counts for every filter value.
 * Each facet ignores its own filter so the numbers answer "what if I picked
 * this instead of my current choice".
 */
export const GET = handler(async (request: Request) => {
  if (isDemo()) return ok(await (await import('@/lib/demo')).demoFacets());
  const url = new URL(request.url);
  const query = parseSearchParams(url.searchParams);
  const userId = await getUserId();
  const profile = userId ? await getProfile(userId) : null;
  return ok(await computeFacets(query, profile, userId));
});
