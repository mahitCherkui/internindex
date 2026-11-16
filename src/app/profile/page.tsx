import { redirect } from 'next/navigation';
import { ProfileClient } from '@/components/ProfileClient';
import { getUserId } from '@/lib/auth';
import { getProfile } from '@/lib/repo';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if (isDemo()) return <ProfileClient initial={(await import('@/lib/demo')).demoProfile()} />;
  const userId = await getUserId();
  if (!userId) redirect('/login?next=/profile');
  return <ProfileClient initial={await getProfile(userId)} />;
}
