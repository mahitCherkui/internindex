'use client';

import { memo } from 'react';
import { isNew } from '@/lib/listing-actions';
import type { InternshipView } from '@/lib/types';
import { roleFamilyLabel } from '@/lib/types';
import { daysUntil, formatPay, shortAge } from '@/lib/util';
import { CompanyLogo } from './CompanyLogo';
import { Icon, MatchRing, matchLabel } from './Match';
import { StatusBadge } from './ui';

/**
 * One search result, laid out like a modern job feed: logo, freshness chips,
 * title, a grid of the facts that decide whether to apply, and a match panel
 * on the right with the score ring and the eligibility signals that matter.
 */
export const InternshipCard = memo(function InternshipCard({
  listing,
  selected = false,
  onSelect,
  onTrack,
  onBookmark,
  onHide,
  onApplyTrack,
}: {
  listing: InternshipView;
  selected?: boolean;
  onSelect?: (listing: InternshipView) => void;
  onTrack: (listing: InternshipView) => void;
  onBookmark: (listing: InternshipView) => void;
  onHide: (listing: InternshipView) => void;
  onApplyTrack?: (listing: InternshipView) => void;
}) {
  const pay = formatPay(listing.salary_min, listing.salary_max, listing.salary_period, listing.salary_currency ?? 'USD');
  const posted = listing.date_posted ?? listing.first_seen_at;
  const fresh = isNew(listing);
  const deadlineDays = daysUntil(listing.deadline);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  const arrangement =
    listing.location_type === 'remote' ? 'Remote' : listing.location_type === 'hybrid' ? 'Hybrid' : listing.location_type === 'onsite' ? 'Onsite' : null;
  const term = listing.season !== 'Unknown' ? `${listing.season}${listing.year ? ` ${listing.year}` : ''}` : listing.year ? String(listing.year) : null;
  const program = listing.program_type === 'internship' ? 'Internship' : listing.program_type.charAt(0).toUpperCase() + listing.program_type.slice(1);
  const eligibilityText =
    listing.eligibility.status === 'ineligible'
      ? 'Not eligible'
      : listing.underclass_ok === 1
        ? 'Fr / Soph OK'
        : listing.class_years.length
          ? listing.class_years.join(', ')
          : listing.underclass_ok === 0
            ? 'Juniors+'
            : null;

  const facts: { icon: () => React.ReactNode; text: string | null; tone?: string }[] = [
    { icon: Icon.pin, text: listing.primary_location ? `${listing.primary_location}${listing.locations.length > 1 ? ` +${listing.locations.length - 1}` : ''}` : null },
    { icon: Icon.briefcase, text: program },
    { icon: Icon.building, text: arrangement },
    { icon: Icon.calendar, text: term },
    { icon: Icon.dollar, text: pay, tone: 'var(--good-text)' },
    { icon: Icon.cap, text: eligibilityText, tone: listing.eligibility.status === 'ineligible' ? 'var(--critical)' : listing.underclass_ok === 1 ? 'var(--good-text)' : undefined },
  ].filter((f) => f.text);

  const signals: string[] = [];
  if (listing.underclass_ok === 1) signals.push('Open to fr / soph');
  if (listing.sponsorship === 'offers') signals.push('Sponsors visas');
  if (listing.eligibility.status === 'eligible') signals.push('You meet eligibility');
  if (listing.gpa_min == null && listing.description) signals.push('No GPA cutoff');

  return (
    <article
      id={`listing-${listing.id}`}
      role={onSelect ? 'option' : undefined}
      aria-selected={onSelect ? selected : undefined}
      tabIndex={onSelect ? -1 : undefined}
      onClick={onSelect ? () => onSelect(listing) : undefined}
      className={`card ${onSelect ? 'card-interactive' : ''} group flex overflow-hidden`}
      style={{ borderRadius: 18 }}
    >
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start gap-3.5">
          <CompanyLogo company={listing.company} companyUrl={listing.company_url} applyUrl={listing.apply_url} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="badge badge-time" title={`First seen ${new Date(listing.first_seen_at * 1000).toLocaleString()}`}>
                {listing.date_posted ? shortAge(posted) : `Seen ${shortAge(listing.first_seen_at)}`}
              </span>
              {fresh ? <span className="badge badge-new">Early applicant</span> : null}
              {deadlineDays != null && deadlineDays >= 0 && deadlineDays <= 14 ? (
                <span className={`badge ${deadlineDays <= 3 ? 'badge-bad' : 'badge-warn'}`}>
                  {deadlineDays === 0 ? 'Closes today' : `Closes in ${deadlineDays}d`}
                </span>
              ) : null}
              {listing.application_status ? <StatusBadge status={listing.application_status} small /> : null}
            </div>
            <h3 className="mt-1.5 text-[1.0625rem] leading-snug font-bold tracking-[-0.015em]">
              {onSelect ? (
                listing.title
              ) : (
                <a href={listing.apply_url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                  {listing.title}
                </a>
              )}
            </h3>
            <p className="mt-0.5 truncate text-[0.8125rem]">
              <span className="font-semibold">{listing.company}</span>
              <span style={{ color: 'var(--ink-muted)' }}> / {roleFamilyLabel(listing.role_family)}</span>
            </p>
          </div>
        </div>

        <div className="my-3 h-px" style={{ background: 'var(--line)' }} />

        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[0.8125rem] sm:grid-cols-3" style={{ color: 'var(--ink-secondary)' }}>
          {facts.map(({ icon: FactIcon, text, tone }) => (
            <li key={String(text)} className="flex min-w-0 items-center gap-1.5" style={tone ? { color: tone } : undefined}>
              <span className="shrink-0" style={{ color: 'var(--ink-muted)' }}>
                <FactIcon />
              </span>
              <span className="truncate">{text}</span>
            </li>
          ))}
        </ul>

        {listing.match?.missing.length ? (
          <p className="mt-2.5 truncate text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
            Missing keywords:{' '}
            <span style={{ color: 'var(--critical)' }}>{listing.match.missing.slice(0, 3).join(', ')}</span>
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2" onClick={stop}>
          <span className="truncate text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
            {listing.seen_sources.length > 1 ? `Seen on ${listing.seen_sources.length} sources` : ''}
          </span>
          <span className="flex-1" />
          <button type="button" className="btn btn-icon" onClick={() => onHide(listing)} title="Not interested (h)" aria-label="Not interested: hide this listing">
            <Icon.ban />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onBookmark(listing)}
            aria-pressed={listing.bookmarked}
            aria-label={listing.bookmarked ? 'Remove from saved' : 'Save (s)'}
            title={listing.bookmarked ? 'Saved' : 'Save (s)'}
            style={listing.bookmarked ? { color: '#e5484d' } : undefined}
          >
            <Icon.heart filled={listing.bookmarked} />
          </button>
          {listing.applied ? (
            <a href={`/tracker/${listing.application_id}`} className="btn btn-pill">
              Applied ✓
            </a>
          ) : onApplyTrack ? (
            <button type="button" className="btn btn-primary px-5 py-2.5 uppercase" onClick={() => onApplyTrack(listing)} title="Opens the application and tracks it as Applied (a)">
              Apply now
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-pill" onClick={() => onTrack(listing)}>
                Track
              </button>
              <a href={listing.apply_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary px-5 py-2.5 uppercase">
                Apply now
              </a>
            </>
          )}
        </div>
      </div>

      {/* Match panel */}
      <div className="m-2 ml-0 hidden w-40 shrink-0 flex-col items-center rounded-2xl px-3 py-4 text-center sm:flex xl:w-44" style={{ background: 'var(--match-panel)', color: '#fff' }}>
        {listing.match ? (
          <>
            <MatchRing score={listing.match.score} />
            <p className="mt-2 text-[0.75rem] font-bold tracking-[0.08em] uppercase">{matchLabel(listing.match.score)}</p>
          </>
        ) : (
          <>
            <span className="flex h-[84px] w-[84px] items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <Icon.lock />
            </span>
            <p className="mt-2 text-[0.75rem] font-bold tracking-[0.08em] uppercase">Match score</p>
            <a href="/profile" className="mt-1 text-[0.6875rem] underline opacity-70" onClick={stop}>
              Add your resume
            </a>
          </>
        )}
        <div className="my-3 h-px w-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        <ul className="w-full space-y-1 text-left text-[0.6875rem]">
          {signals.slice(0, 3).map((signal) => (
            <li key={signal} className="flex items-center gap-1.5">
              <span style={{ color: '#3ee8a0' }}>
                <Icon.check />
              </span>
              {signal}
            </li>
          ))}
          {listing.eligibility.status === 'ineligible' ? (
            <li className="flex items-start gap-1.5" style={{ color: '#ff9b8a' }} title={listing.eligibility.flags.join('\n')}>
              ✕ <span className="line-clamp-2">{listing.eligibility.flags[0]}</span>
            </li>
          ) : null}
        </ul>
      </div>
    </article>
  );
});

export function MatchPill({ score, large = false }: { score: number; large?: boolean }) {
  const cls = score >= 70 ? 'badge-good' : score >= 40 ? 'badge-warn' : 'badge-neutral';
  return (
    <span className={`badge tnum ${cls}`} style={large ? { fontSize: '0.8125rem', padding: '0.2rem 0.5rem' } : undefined} title="Share of this posting's top ATS keywords found in your resume and skills">
      {score}% match
    </span>
  );
}

export function EligibilityPill({ listing }: { listing: InternshipView }) {
  const e = listing.eligibility;
  if (e.status === 'unclear' && e.flags.length === 0) {
    return listing.underclass_ok === 0 ? <span className="badge badge-neutral">Juniors+ / grads</span> : null;
  }
  const cls = e.status === 'eligible' ? 'badge-good' : e.status === 'likely' ? 'badge-warn' : e.status === 'ineligible' ? 'badge-bad' : 'badge-neutral';
  const icon = e.status === 'eligible' ? '✓' : e.status === 'ineligible' ? '✕' : '•';
  return (
    <span className={`badge ${cls}`} title={e.flags.join('\n') || e.label}>
      <span aria-hidden>{icon}</span> {e.label}
    </span>
  );
}
