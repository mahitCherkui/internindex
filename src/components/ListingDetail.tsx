'use client';

import { useEffect, useState } from 'react';
import type { Breakdown, QualificationItem } from '@/lib/breakdown';
import { isNew } from '@/lib/listing-actions';
import { KIND_LABELS, type InternshipView } from '@/lib/types';
import { daysUntil, formatDate, shortAge } from '@/lib/util';
import { CompanyLogo } from './CompanyLogo';
import { EligibilityPill } from './InternshipCard';
import { Icon, MatchRing, matchLabel } from './Match';
import { ExternalIcon, StatusBadge } from './ui';

type Detail = InternshipView & { breakdown: Breakdown };

/**
 * The side panel for one posting: a big Apply button, the requirements split
 * into must-have and nice-to-have, eligibility facts, and a "How to pass the
 * ATS" panel built from the posting's own keywords against your resume.
 */
export function ListingDetail({
  listing,
  onClose,
  onApply,
  onApplyTrack,
  onTrack,
  onBookmark,
  onHide,
}: {
  listing: InternshipView;
  onClose?: () => void;
  onApply: (listing: InternshipView) => void;
  onApplyTrack: (listing: InternshipView) => void;
  onTrack: (listing: InternshipView) => void;
  onBookmark: (listing: InternshipView) => void;
  onHide: (listing: InternshipView) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    setShowDescription(false);
    fetch(`/api/internships/${listing.id}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDetail)
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError('Could not load the requirements breakdown.');
      });
    return () => controller.abort();
  }, [listing.id]);

  // The list row carries live tracker/bookmark state; the fetched detail adds the breakdown.
  const view: InternshipView = { ...(detail ?? listing), ...pickLive(listing) };
  const b = detail?.breakdown ?? null;
  const deadline = daysUntil(view.deadline);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-4 sm:p-5" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-start gap-3.5">
          <CompanyLogo company={view.company} companyUrl={view.company_url} applyUrl={view.apply_url} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="badge badge-time">{view.date_posted ? shortAge(view.date_posted) : `Seen ${shortAge(view.first_seen_at)}`}</span>
              {isNew(view) ? <span className="badge badge-new">Early applicant</span> : null}
              <EligibilityPill listing={view} />
              {view.application_status ? <StatusBadge status={view.application_status} small /> : null}
            </div>
            <h2 className="mt-1.5 text-xl leading-snug font-bold tracking-[-0.02em]">{view.title}</h2>
            <p className="mt-0.5 text-[0.875rem]">
              <span className="font-semibold">{view.company}</span>
              <span style={{ color: 'var(--ink-muted)' }}>
                {' · '}
                {[view.primary_location, view.location_type !== 'unknown' ? view.location_type : null].filter(Boolean).join(' · ')}
              </span>
            </p>
          </div>
          {onClose ? (
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
              ✕
            </button>
          ) : null}
        </div>

        {deadline != null && deadline >= 0 && deadline <= 14 ? (
          <p className="mt-3 rounded-xl px-3 py-2 text-[0.8125rem] font-medium" style={{ background: deadline <= 3 ? 'var(--critical-soft)' : 'var(--warning-soft)', color: deadline <= 3 ? 'var(--critical)' : 'var(--warning-text)' }} role="status">
            ⏰ {deadline === 0 ? 'Applications close today' : `Applications close in ${deadline} day${deadline === 1 ? '' : 's'}`} ({formatDate(view.deadline)})
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-lg px-6 uppercase" onClick={() => onApply(view)} title={`Opens the application on ${applyHost(view.apply_url)}`}>
            Apply now <ExternalIcon />
          </button>
          {view.applied ? (
            <a href={`/tracker/${view.application_id}`} className="btn btn-lg btn-pill">
              In tracker ✓
            </a>
          ) : (
            <button type="button" className="btn btn-lg btn-pill" onClick={() => onApplyTrack(view)} title="Open the application and add it to your tracker as Applied today (a)">
              Apply + Track
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => onBookmark(view)}
            aria-pressed={view.bookmarked}
            aria-label={view.bookmarked ? 'Remove from saved' : 'Save'}
            style={view.bookmarked ? { color: '#e5484d' } : undefined}
          >
            <Icon.heart filled={view.bookmarked} />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => onHide(view)} aria-label="Not interested">
            <Icon.ban />
          </button>
          {!view.applied ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTrack(view)}>
              Track with notes…
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[0.6875rem]" style={{ color: 'var(--ink-muted)' }}>
          Applies on {applyHost(view.apply_url)}, the original posting.
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        {error ? (
          <p className="text-[0.8125rem]" style={{ color: 'var(--critical)' }}>
            {error}
          </p>
        ) : null}

        {/* Red flags first: they decide whether to bother. */}
        {view.eligibility.flags.length ? (
          <section className="rounded-xl p-3.5" style={{ background: view.eligibility.status === 'ineligible' ? 'var(--critical-soft)' : 'var(--warning-soft)' }}>
            <h3 className="text-[0.8125rem] font-semibold" style={{ color: view.eligibility.status === 'ineligible' ? 'var(--critical)' : 'var(--warning-text)' }}>
              {view.eligibility.status === 'ineligible' ? '✕ Red flags' : '! Check before applying'}
            </h3>
            <ul className="mt-1.5 space-y-1 text-[0.8125rem]">
              {view.eligibility.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Match */}
        <section className="flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center" style={{ background: 'var(--match-panel)', color: '#fff' }}>
          {view.match ? (
            <div className="flex flex-col items-center">
              <MatchRing score={view.match.score} size={96} />
              <p className="mt-1.5 text-[0.75rem] font-bold tracking-[0.08em] uppercase">{matchLabel(view.match.score)}</p>
            </div>
          ) : (
            <a href="/profile" className="flex flex-col items-center text-center">
              <span className="flex h-24 w-24 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <Icon.lock />
              </span>
              <span className="mt-1.5 text-[0.75rem] font-semibold underline">Add your resume</span>
            </a>
          )}
          <div className="grid flex-1 grid-cols-3 gap-2 text-center">
            <SubScore label="Skills" value={view.match ? `${view.match.have.length}/${view.match.have.length + view.match.missing.length}` : '–'} good={!!view.match && view.match.score >= 60} />
            <SubScore
              label="Eligibility"
              value={view.eligibility.status === 'ineligible' ? 'No' : view.eligibility.status === 'eligible' ? 'Yes' : 'Check'}
              good={view.eligibility.status === 'eligible'}
              bad={view.eligibility.status === 'ineligible'}
            />
            <SubScore
              label="Fr / Soph"
              value={view.underclass_ok === 1 ? 'Open' : view.underclass_ok === 0 ? 'No' : 'Unstated'}
              good={view.underclass_ok === 1}
              bad={view.underclass_ok === 0}
            />
          </div>
        </section>

        {view.match ? (
          <section className="grid gap-3 sm:grid-cols-2">
            <TermList title={`You have (${view.match.have.length})`} terms={view.match.have} tone="good" empty="None of the top keywords yet" />
            <TermList title={`Missing (${view.match.missing.length})`} terms={view.match.missing} tone="bad" empty="You cover every top keyword" />
          </section>
        ) : null}

        {/* Requirements */}
        {b ? (
          <>
            <section>
              <SectionHead title="Requirements" hint={b.splitMethod === 'sentences' ? 'No qualification headings in this posting; split by wording' : undefined} />
              {b.must.length || b.nice.length ? (
                <div className="space-y-3">
                  {b.mustItems.length ? <ReqList title="Required" items={b.mustItems} tone="must" known={!!view.match} /> : null}
                  {b.niceItems.length ? <ReqList title="Preferred" items={b.niceItems} tone="nice" known={!!view.match} /> : null}
                </div>
              ) : (
                <p className="text-[0.8125rem]" style={{ color: 'var(--ink-muted)' }}>
                  {view.description ? 'This posting doesn’t list qualifications in a recognizable way. Read the full description below.' : 'This source only provides the title and location. Open the posting for its requirements.'}
                </p>
              )}
            </section>

            <section>
              <SectionHead title="Eligibility & logistics" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[0.8125rem] sm:grid-cols-3">
                {b.facts.map((fact) => (
                  <div key={fact.label} className="min-w-0">
                    <dt className="text-[0.6875rem] font-medium tracking-wide uppercase" style={{ color: 'var(--ink-muted)' }}>
                      {fact.label}
                    </dt>
                    <dd className="mt-0.5" style={{ color: fact.tone === 'good' ? 'var(--good-text)' : fact.tone === 'bad' ? 'var(--critical)' : undefined }}>
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
              <SectionHead title="How to pass the ATS" />
              {b.keywords.length ? (
                <div className="mb-3 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                  <table className="w-full text-left text-[0.75rem]">
                    <thead style={{ background: 'var(--surface-1)', color: 'var(--ink-muted)' }}>
                      <tr>
                        <th className="px-2.5 py-1.5 font-medium">Keyword</th>
                        <th className="px-2.5 py-1.5 font-medium">×</th>
                        <th className="hidden px-2.5 py-1.5 font-medium sm:table-cell">Put it in</th>
                        <th className="px-2.5 py-1.5 font-medium">You</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.keywords.slice(0, 14).map((k) => (
                        <tr key={k.term} className="border-t" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}>
                          <td className="px-2.5 py-1.5 font-medium">{k.term}</td>
                          <td className="tnum px-2.5 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                            {k.count}
                          </td>
                          <td className="hidden px-2.5 py-1.5 sm:table-cell" style={{ color: 'var(--ink-secondary)' }}>
                            {k.section}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {k.have == null ? '–' : k.have ? <span style={{ color: 'var(--good-text)' }}>✓ have</span> : <span style={{ color: 'var(--critical)' }}>✕ add</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <ol className="list-decimal space-y-1.5 pl-5 text-[0.8125rem]">
                {b.atsTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ol>
            </section>
          </>
        ) : !error ? (
          <DetailSkeleton />
        ) : null}

        {view.description ? (
          <section>
            <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setShowDescription((v) => !v)} aria-expanded={showDescription}>
              {showDescription ? '▾ Hide full description' : '▸ Show full description'}
            </button>
            {showDescription ? (
              <p className="mt-2 text-[0.8125rem] leading-relaxed whitespace-pre-line" style={{ color: 'var(--ink-secondary)' }}>
                {view.description}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
          Seen on: {view.seen_sources.map(sourceLabel).join(' · ')} · first seen {formatDate(view.first_seen_at)}
        </section>
      </div>
    </div>
  );
}

function pickLive(listing: InternshipView): Partial<InternshipView> {
  return {
    bookmarked: listing.bookmarked,
    applied: listing.applied,
    application_id: listing.application_id,
    application_status: listing.application_status,
  };
}

function applyHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('greenhouse')) return 'Greenhouse';
    if (host.includes('lever.co')) return 'Lever';
    if (host.includes('ashbyhq')) return 'Ashby';
    if (host.includes('myworkdayjobs')) return 'Workday';
    if (host.includes('smartrecruiters')) return 'SmartRecruiters';
    return host.split('.').slice(-2).join('.');
  } catch {
    return 'company site';
  }
}

export function sourceLabel(source: string): string {
  const [kind, token] = source.split(':');
  if (kind === 'github') return `GitHub (${token})`;
  return KIND_LABELS[kind] ?? kind;
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
      {hint ? (
        <span className="text-[0.6875rem]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ReqList({ title, items, tone, known }: { title: string; items: QualificationItem[]; tone: 'must' | 'nice'; known: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-[0.6875rem] font-bold tracking-[0.08em] uppercase" style={{ color: tone === 'must' ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const state = !known || (item.have.length === 0 && item.missing.length === 0) ? 'neutral' : item.missing.length === 0 ? 'have' : item.have.length ? 'partial' : 'missing';
          return (
            <li key={item.text} className="flex gap-2.5 text-[0.8125rem] leading-relaxed">
              <span
                aria-label={state === 'have' ? 'You have this' : state === 'missing' ? 'Missing' : state === 'partial' ? 'Partly' : undefined}
                className="mt-[0.2rem] flex h-[1.05rem] w-[1.05rem] shrink-0 items-center justify-center rounded-full text-[0.625rem]"
                style={{
                  background: state === 'have' ? 'var(--brand)' : state === 'partial' ? 'var(--warning-soft)' : state === 'missing' ? 'var(--critical-soft)' : 'var(--surface-3)',
                  color: state === 'have' ? 'var(--brand-ink)' : state === 'partial' ? 'var(--warning-text)' : state === 'missing' ? 'var(--critical)' : 'var(--ink-muted)',
                }}
              >
                {state === 'have' ? <Icon.check /> : state === 'missing' ? '✕' : state === 'partial' ? '~' : '•'}
              </span>
              <span style={{ color: tone === 'must' ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}>
                <Highlighted text={item.text} have={item.have} missing={item.missing} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Underline the skills inside a qualification line: green when you have them, red when not. */
function Highlighted({ text, have, missing }: { text: string; have: string[]; missing: string[] }) {
  const terms = [...have.map((t) => [t, 'have'] as const), ...missing.map((t) => [t, 'missing'] as const)];
  if (!terms.length) return <>{text}</>;
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  const re = new RegExp(`(${terms.map(([t]) => escape(t)).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => {
        const hit = terms.find(([t]) => t.toLowerCase() === part.toLowerCase());
        return hit ? (
          <mark key={i} className="rounded px-0.5 font-semibold" style={{ background: hit[1] === 'have' ? 'var(--accent-soft)' : 'var(--critical-soft)', color: hit[1] === 'have' ? 'var(--accent)' : 'var(--critical)' }}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function SubScore({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-xl px-2 py-2.5" style={{ background: 'rgba(255,255,255,0.07)' }}>
      <p className="text-[1rem] font-bold" style={{ color: good ? '#3ee8a0' : bad ? '#ff9b8a' : '#fff' }}>
        {value}
      </p>
      <p className="mt-0.5 text-[0.625rem] font-semibold tracking-[0.08em] uppercase opacity-70">{label}</p>
    </div>
  );
}

function TermList({ title, terms, tone, empty }: { title: string; terms: string[]; tone: 'good' | 'bad'; empty: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
      <p className="mb-1.5 text-[0.75rem] font-semibold" style={{ color: tone === 'good' ? 'var(--good-text)' : 'var(--critical)' }}>
        {title}
      </p>
      {terms.length ? (
        <div className="flex flex-wrap gap-1">
          {terms.map((t) => (
            <span key={t} className={`chip ${tone === 'good' ? 'chip-good' : 'chip-bad'}`}>
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
          {empty}
        </p>
      )}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="skeleton h-4 w-32" />
      <div className="space-y-2">
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-11/12" />
        <div className="skeleton h-3 w-4/5" />
      </div>
      <div className="skeleton h-4 w-40" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-8" />
        ))}
      </div>
      <div className="skeleton h-28 w-full" />
    </div>
  );
}
