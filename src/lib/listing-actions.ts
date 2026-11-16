'use client';

import type { AppStatus, InternshipView } from './types';

/** Statuses that "Apply + Track" may advance to Applied without losing progress. */
const BEFORE_APPLIED: (AppStatus | null)[] = [null, 'interested', 'preparing'];

/**
 * Open the original application page and record the role as Applied today.
 *
 * The tab is opened synchronously, inside the click or keypress, so browsers
 * don't treat it as a pop-up; the tracker write happens after. A role already
 * tracked as Interested/Preparing is moved to Applied rather than duplicated,
 * and one already further along is left alone.
 */
export async function applyAndTrack(
  listing: InternshipView,
  opts: { open?: boolean } = {},
): Promise<{ applicationId: number; status: AppStatus } | { error: string }> {
  if (opts.open !== false) window.open(listing.apply_url, '_blank', 'noopener,noreferrer');

  if (listing.application_id && !BEFORE_APPLIED.includes(listing.application_status)) {
    return { applicationId: listing.application_id, status: listing.application_status! };
  }
  if (listing.application_id) {
    const res = await fetch(`/api/applications/${listing.application_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied' }),
    });
    if (!res.ok) return { error: 'Opened the application, but could not update your tracker.' };
    return { applicationId: listing.application_id, status: 'applied' };
  }

  const res = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ internship_id: listing.id, status: 'applied', origin: 'internindex' }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { applicationId: data.application.id, status: data.application.status };
  if (data.duplicate && data.application_id) {
    await fetch(`/api/applications/${data.application_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied' }),
    });
    return { applicationId: data.application_id, status: 'applied' };
  }
  return { error: data.error ?? 'Opened the application, but could not add it to your tracker.' };
}

export async function toggleBookmark(listing: InternshipView): Promise<boolean> {
  const res = await fetch(`/api/internships/${listing.id}/bookmark`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not update the shortlist.');
  const data = await res.json();
  return Boolean(data.bookmarked);
}

export async function hideListing(listing: InternshipView): Promise<void> {
  const res = await fetch(`/api/internships/${listing.id}/hide`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not hide that listing.');
}

/**
 * Whether a listing was posted in the last 24 hours. Undated postings use the
 * same three-day handicap as the Newest sort, so a feed that never states dates
 * doesn't mark its whole backlog "Early applicant" the day it's first read.
 */
export function isNew(listing: Pick<InternshipView, 'first_seen_at' | 'date_posted'>, now = Date.now()): boolean {
  const posted = listing.date_posted ?? listing.first_seen_at - 259_200;
  return now / 1000 - posted < 86_400;
}
