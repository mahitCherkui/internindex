import { handler, ok, requireUserId } from '@/lib/api';
import { exec, nowSec } from '@/lib/db';
import { isDemo } from '@/lib/demo';
import { buildDigest } from '@/lib/digest';

export const dynamic = 'force-dynamic';

/** GET /api/digest: today's new roles for each saved search, plus closing-soon saves. */
export const GET = handler(async () => {
  if (isDemo()) return ok({ generatedAt: nowSec(), sections: [], closingSoon: [], seenAt: null });
  const auth = await requireUserId();
  if (auth instanceof Response) return auth;
  return ok(await buildDigest(auth));
});

/** POST /api/digest: mark today's digest as read. */
export const POST = handler(async () => {
  if (isDemo()) return ok({ seenAt: nowSec() });
  const auth = await requireUserId();
  if (auth instanceof Response) return auth;
  const now = nowSec();
  await exec('UPDATE profiles SET digest_seen_at = ? WHERE user_id = ?', [now, auth]);
  return ok({ seenAt: now });
});
