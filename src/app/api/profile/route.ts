import { handler, ok, readJson, requireUserId } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { getProfile, updateProfile } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/** GET /api/profile */
export const GET = handler(async () => {
  if (isDemo()) return ok({ profile: (await import('@/lib/demo')).demoProfile() });
  const auth = await requireUserId();
  if (auth instanceof Response) return auth;
  return ok({ profile: await getProfile(auth) });
});

/** PATCH /api/profile: drives fit scoring, eligibility filters, and defaults. */
export const PATCH = handler(async (request: Request) => {
  if (isDemo()) return ok({ profile: (await import('@/lib/demo')).updateDemoProfile(await readJson(request)) });
  const auth = await requireUserId();
  if (auth instanceof Response) return auth;

  const profile = await updateProfile(auth, await readJson(request));
  return ok({ profile });
});
