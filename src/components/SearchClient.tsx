'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DigestBanner } from './DigestBanner';
import { countActive, Filters, type QueryPatch } from './Filters';
import { InternshipCard } from './InternshipCard';
import { Icon } from './Match';
import { ListingDetail } from './ListingDetail';
import { QuickCopy } from './QuickCopy';
import { ResumeImport } from './ResumeImport';
import { TrackDialog } from './TrackDialog';
import { applyAndTrack, hideListing, toggleBookmark } from '@/lib/listing-actions';
import {
  parseSearchParams,
  toSearchParams,
  type Facets,
  type SearchQuery,
  type SearchResult,
  type SortKey,
} from '@/lib/search-query';
import { CLASS_YEARS, KIND_LABELS, roleFamilyLabel, type InternshipView, type ProfileView } from '@/lib/types';

const SORT_LABELS: Record<SortKey, string> = {
  recommended: 'Recommended for you',
  newest: 'Newest',
  match: 'Best resume match',
  fit: 'Best overall fit',
  relevance: 'Most relevant',
  deadline: 'Deadline soonest',
  pay: 'Highest pay',
  company: 'Company A–Z',
  title: 'Title A–Z',
};

/** Role-type chips: the tech families a CS/DS student filters by most. */
const ROLE_CHIPS: { label: string; roles: string[] }[] = [
  { label: 'SWE', roles: ['swe-general', 'backend', 'frontend', 'fullstack', 'mobile'] },
  { label: 'Data Science', roles: ['data-science', 'data-analyst'] },
  { label: 'Data Eng', roles: ['data-engineering'] },
  { label: 'ML / AI', roles: ['machine-learning', 'research-scientist'] },
  { label: 'Quant', roles: ['quant-research', 'quant-trading', 'quant-dev'] },
  { label: 'PM', roles: ['product-management'] },
  { label: 'Security', roles: ['security'] },
  { label: 'Infra / SRE', roles: ['devops'] },
  { label: 'Hardware', roles: ['embedded', 'electrical'] },
  { label: 'IT', roles: ['it-support'] },
  { label: 'UX Research', roles: ['ux-research', 'product-design'] },
];

/**
 * The search page: a sticky search bar with filter chips, a fast list, and a
 * side panel with the full breakdown of the selected posting. Nothing reloads
 * the page; the URL tracks the filters so any search is shareable.
 *
 * Keyboard: j/k move, Enter opens, s saves, a applies (+ tracks), h hides,
 * / focuses search, Esc closes the panel.
 */
export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => parseSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [result, setResult] = useState<SearchResult | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(query.q);
  const [drawer, setDrawer] = useState<'filters' | 'copy' | null>(null);
  const [tracking, setTracking] = useState<InternshipView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [applyPrompt, setApplyPrompt] = useState<InternshipView | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(query.q), [query.q]);

  const update = useCallback(
    (patch: QueryPatch, keepPage = false) => {
      const next: SearchQuery = { ...query, ...patch, page: keepPage ? (patch.page ?? query.page) : 1 };
      router.replace(`/?${toSearchParams(next).toString()}`, { scroll: false });
    },
    [query, router],
  );
  const reset = useCallback(() => router.replace('/', { scroll: false }), [router]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const qs = toSearchParams(query).toString();
    Promise.all([
      fetch(`/api/internships?${qs}`, { signal: controller.signal }).then(async (r) => {
        if (r.ok) return r.json();
        const detail = await r.json().then((b) => b?.error as string | undefined).catch(() => undefined);
        throw new Error(detail ? `${detail} (${r.status})` : `Search failed (${r.status})`);
      }),
      fetch(`/api/internships/facets?${qs}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([searchData, facetData]: [SearchResult, Facets | null]) => {
        setResult(searchData);
        if (facetData) setFacets(facetData);
        // Keep the selection when it is still on the page, else select the first row.
        setSelectedId((current) =>
          current && searchData.rows.some((r) => r.id === current) ? current : (searchData.rows[0]?.id ?? null),
        );
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setProfile(data.profile))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const patchRow = useCallback((id: string, patch: Partial<InternshipView>) => {
    setResult((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev));
  }, []);

  const onBookmark = useCallback(
    async (listing: InternshipView) => {
      patchRow(listing.id, { bookmarked: !listing.bookmarked });
      try {
        const bookmarked = await toggleBookmark(listing);
        patchRow(listing.id, { bookmarked });
        setToast(bookmarked ? `Saved ${listing.company} to your shortlist.` : 'Removed from your shortlist.');
      } catch (err) {
        patchRow(listing.id, { bookmarked: listing.bookmarked });
        setToast((err as Error).message);
      }
    },
    [patchRow],
  );

  const onHide = useCallback(
    async (listing: InternshipView) => {
      const index = rows.findIndex((r) => r.id === listing.id);
      const next = rows[index + 1] ?? rows[index - 1] ?? null;
      setResult((prev) => (prev ? { ...prev, rows: prev.rows.filter((r) => r.id !== listing.id), total: prev.total - 1 } : prev));
      if (selectedId === listing.id) setSelectedId(next?.id ?? null);
      try {
        await hideListing(listing);
        setToast(`Hidden: ${listing.title}. It won't appear again.`);
      } catch (err) {
        setToast((err as Error).message);
      }
    },
    [rows, selectedId],
  );

  const onApplyTrack = useCallback(
    async (listing: InternshipView) => {
      const outcome = await applyAndTrack(listing);
      if ('error' in outcome) {
        setToast(outcome.error);
        return;
      }
      patchRow(listing.id, { applied: true, application_id: outcome.applicationId, application_status: outcome.status });
      setToast(`Opened the application and marked ${listing.company} as Applied today.`);
    },
    [patchRow],
  );

  /** Open the original posting, then ask whether to track it, so browsing never marks anything Applied. */
  const onApply = useCallback((listing: InternshipView) => {
    window.open(listing.apply_url, '_blank', 'noopener,noreferrer');
    if (!listing.applied) setApplyPrompt(listing);
  }, []);

  const confirmApplied = async (listing: InternshipView) => {
    setApplyPrompt(null);
    const outcome = await applyAndTrack(listing, { open: false });
    if ('error' in outcome) {
      setToast(outcome.error);
      return;
    }
    patchRow(listing.id, { applied: true, application_id: outcome.applicationId, application_status: outcome.status });
    setToast(`Tracked ${listing.company} as Applied today.`);
  };

  const onTracked = (listing: InternshipView, applicationId: number, status: string) => {
    patchRow(listing.id, { applied: true, application_id: applicationId, application_status: status as InternshipView['application_status'] });
    setTracking(null);
    setToast(`Added ${listing.company} to your tracker.`);
  };

  const select = useCallback((listing: InternshipView) => {
    setSelectedId(listing.id);
    setMobileDetail(true);
  }, []);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (event.key === 'Escape') {
        if (typing && document.activeElement === searchInput.current) searchInput.current?.blur();
        else if (drawer) setDrawer(null);
        else setMobileDetail(false);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || tracking) return;

      const index = rows.findIndex((r) => r.id === selectedId);
      const move = (delta: number) => {
        const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
        if (!next) return;
        setSelectedId(next.id);
        document.getElementById(`listing-${next.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };

      switch (event.key) {
        case '/':
          event.preventDefault();
          searchInput.current?.focus();
          break;
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Enter':
          if (selected) setMobileDetail(true);
          break;
        case 's':
          if (selected) void onBookmark(selected);
          break;
        case 'a':
          if (selected) void onApplyTrack(selected);
          break;
        case 'h':
          if (selected) void onHide(selected);
          break;
        case 'c':
          setDrawer((d) => (d === 'copy' ? null : 'copy'));
          break;
        case '?':
          setToast('Shortcuts: j/k move · Enter open · a apply + track · s save · h hide · c quick copy · / search');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selectedId, selected, drawer, tracking, onBookmark, onApplyTrack, onHide]);

  const saveSearch = async () => {
    const name = window.prompt('Name this search. New matches will show up in your daily digest:');
    if (!name?.trim()) return;
    const res = await fetch('/api/saved-searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), query: toSearchParams(query).toString() }),
    });
    setToast(res.ok ? `Saved "${name.trim()}". It's now in your daily digest.` : 'Could not save that search.');
  };

  const hasResume = Boolean(profile?.resume_text || profile?.skills?.length);
  const total = result?.total ?? 0;
  const pages = result?.pages ?? 1;
  const activeFilters = countActive(query);
  const roleChipOn = (roles: string[]) => roles.every((r) => query.roleFamilies.includes(r));
  const toggleRoles = (roles: string[]) =>
    update({
      roleFamilies: roleChipOn(roles)
        ? query.roleFamilies.filter((r) => !roles.includes(r))
        : [...new Set([...query.roleFamilies, ...roles])],
    });

  const tab = query.bookmarkedOnly ? 'saved' : query.appliedOnly ? 'applied' : query.sort === 'recommended' ? 'recommended' : 'newest';
  const setTab = (next: 'recommended' | 'newest' | 'saved' | 'applied') =>
    update({
      bookmarkedOnly: next === 'saved',
      appliedOnly: next === 'applied',
      sort: next === 'recommended' ? 'recommended' : 'newest',
      // Saved and applied roles stay visible after they close, so you can find them.
      showClosed: next === 'saved' || next === 'applied',
    });

  return (
    <div className="flex h-[calc(100dvh-53px)] flex-col overflow-hidden lg:h-screen">
      {/* Fixed top bar: tabs, search, chips. Only the list and the panel scroll. */}
      <header className="no-print shrink-0 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
        <div className="flex items-end justify-between gap-4 px-4 pt-3 sm:px-6">
          <div className="flex items-end gap-5 overflow-x-auto" role="tablist" aria-label="Job lists">
            <h1 className="hidden pb-2 text-[1.375rem] font-extrabold tracking-[-0.02em] sm:block">JOBS</h1>
            {(
              [
                ['recommended', 'Recommended'],
                ['newest', 'Newest'],
                ['saved', 'Saved'],
                ['applied', 'Applied'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="hidden items-center gap-1 pb-2.5 text-[0.6875rem] xl:flex" style={{ color: 'var(--ink-muted)' }}>
            <span className="kbd">j</span>
            <span className="kbd">k</span> move <span className="kbd">a</span> apply <span className="kbd">s</span> save <span className="kbd">h</span> hide <span className="kbd">c</span> copy
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 pt-3 sm:px-6">
          <form
            className="relative flex min-w-0 flex-1 items-center"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: text });
            }}
            role="search"
          >
            <SearchGlyph />
            <input
              ref={searchInput}
              className="input h-11 pr-8 pl-10 text-[0.875rem]"
              style={{ borderRadius: 999 }}
              type="search"
              placeholder="Search roles, companies, skills…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search internships"
            />
            <span className="kbd pointer-events-none absolute right-3.5 hidden sm:inline-flex" aria-hidden>
              /
            </span>
          </form>
          <select className="select h-11 w-auto max-w-[9rem] shrink-0 sm:max-w-[12rem]" style={{ borderRadius: 999 }} value={query.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} aria-label="Sort results">
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value} disabled={(value === 'match' || value === 'fit') && !hasResume}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-3 sm:px-6" role="toolbar" aria-label="Quick filters">
          <button type="button" className="fchip" aria-pressed={query.newToday} onClick={() => update({ newToday: !query.newToday })}>
            <Icon.bolt /> Last 24h
          </button>
          <button type="button" className="fchip" aria-pressed={query.underclass} onClick={() => update({ underclass: !query.underclass })} title="Hide postings that require juniors, seniors, or an earlier graduation date">
            Fr / Soph eligible
          </button>
          <select className="fchip" aria-label="Minimum resume match" value={query.minMatch ?? ''} onChange={(e) => update({ minMatch: e.target.value ? Number(e.target.value) : null })} aria-pressed={query.minMatch != null} disabled={!profile}>
            <option value="">Match: any</option>
            <option value="30">Match 30%+</option>
            <option value="50">Match 50%+</option>
            <option value="70">Match 70%+</option>
          </select>
          <span className="mx-1 h-5 w-px shrink-0" style={{ background: 'var(--line-strong)' }} aria-hidden />
          {ROLE_CHIPS.map((chip) => (
            <button key={chip.label} type="button" className="fchip" aria-pressed={roleChipOn(chip.roles)} onClick={() => toggleRoles(chip.roles)}>
              {chip.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0" style={{ background: 'var(--line-strong)' }} aria-hidden />
          <select className="fchip" aria-label="Season" aria-pressed={query.seasons.length > 0} value={query.seasons[0] ?? ''} onChange={(e) => update({ seasons: e.target.value ? [e.target.value] : [] })}>
            <option value="">Season</option>
            {['Summer', 'Fall', 'Winter', 'Spring'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="fchip" aria-label="Location type" aria-pressed={query.locationTypes.length > 0} value={query.locationTypes[0] ?? ''} onChange={(e) => update({ locationTypes: e.target.value ? [e.target.value] : [] })}>
            <option value="">Work type</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
          <select className="fchip" aria-label="Class year" aria-pressed={query.classYears.length > 0} value={query.classYears[0] ?? ''} onChange={(e) => update({ classYears: e.target.value ? [e.target.value] : [] })}>
            <option value="">Class year</option>
            {CLASS_YEARS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="fchip" aria-label="Sponsorship" aria-pressed={query.sponsorship.length > 0} value={query.sponsorship[0] ?? ''} onChange={(e) => update({ sponsorship: e.target.value ? [e.target.value] : [] })}>
            <option value="">Sponsorship</option>
            <option value="offers">Sponsors visas</option>
            <option value="unknown">Not stated</option>
            <option value="does-not-offer">No sponsorship</option>
          </select>
          <select className="fchip" aria-label="Source" aria-pressed={query.sources.length > 0} value={query.sources[0] ?? ''} onChange={(e) => update({ sources: e.target.value ? [e.target.value] : [] })}>
            <option value="">Source</option>
            {(facets?.sources ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {KIND_LABELS[s.value] ?? s.value} ({s.count.toLocaleString()})
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <button type="button" className="fchip fchip-brand" onClick={() => setDrawer('filters')}>
            ••• All filters{activeFilters ? ` · ${activeFilters}` : ''}
          </button>
          <button type="button" className="fchip" onClick={() => setDrawer('copy')} title="Your standard application answers (c)">
            Quick copy
          </button>
        </div>
      </header>

      {/* Body: list and detail scroll on their own. */}
      <div className="flex min-h-0 flex-1">
        <div ref={listRef} className="min-w-0 flex-1 overflow-y-auto" style={{ background: 'var(--surface-page)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-6">
            <p className="text-[0.8125rem]" style={{ color: 'var(--ink-secondary)' }} aria-live="polite">
              {loading && !result ? (
                'Searching…'
              ) : error ? (
                'Something went wrong.'
              ) : (
                <>
                  <strong className="tnum" style={{ color: 'var(--ink-primary)' }}>
                    {total.toLocaleString()}
                  </strong>{' '}
                  {tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : 'open'} internship{total === 1 ? '' : 's'}
                  {query.roleFamilies.length ? ` · ${query.roleFamilies.map(roleFamilyLabel).slice(0, 3).join(', ')}${query.roleFamilies.length > 3 ? '…' : ''}` : ''}
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {activeFilters ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                  Clear filters
                </button>
              ) : null}
              <button type="button" className="btn btn-sm btn-pill" onClick={saveSearch}>
                Save search
              </button>
            </div>
          </div>

          <DigestBanner />

          {profile && !hasResume ? (
            <section className="mx-4 mt-3 rounded-2xl border p-4 sm:mx-6" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }} aria-label="Upload your resume">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[0.9375rem] font-bold">Upload your resume to get recommendations</p>
                <p className="text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
                  Fills your profile, scores every job, and flags what you&rsquo;re missing.
                </p>
              </div>
              <ResumeImport
                compact
                onSaved={(next) => {
                  setProfile(next);
                  setToast('Resume saved. Showing jobs recommended for you.');
                  update({ sort: 'recommended', bookmarkedOnly: false, appliedOnly: false });
                }}
              />
            </section>
          ) : null}

          <div className="px-4 pt-3 pb-8 sm:px-6">
            {error ? (
              <Empty title="Search failed" body={error} action={<button type="button" className="btn btn-sm" onClick={() => update({})}>Try again</button>} />
            ) : !result && loading ? (
              <ListSkeleton />
            ) : rows.length === 0 && !loading ? (
              <Empty
                title={tab === 'saved' ? 'Nothing saved yet' : tab === 'applied' ? 'No applications yet' : 'No open internships match'}
                body={tab === 'saved' ? 'Tap the heart on any job (or press s) to save it here.' : tab === 'applied' ? 'Use Apply now and confirm, or press a, and roles land here.' : 'Try removing a chip or widening the season. New roles arrive every hour.'}
                action={
                  <button type="button" className="btn btn-sm" onClick={reset}>
                    Back to all jobs
                  </button>
                }
              />
            ) : (
              <>
                <div role="listbox" aria-label="Internships" className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
                  {rows.map((listing) => (
                    <InternshipCard
                      key={listing.id}
                      listing={listing}
                      selected={listing.id === selectedId}
                      onSelect={select}
                      onTrack={setTracking}
                      onBookmark={onBookmark}
                      onHide={onHide}
                      onApplyTrack={onApply}
                    />
                  ))}
                </div>
                {pages > 1 ? (
                  <nav className="mt-5 flex items-center justify-center gap-2" aria-label="Pagination">
                    <button type="button" className="btn btn-sm btn-pill" disabled={query.page <= 1} onClick={() => update({ page: query.page - 1 }, true)}>
                      ← Previous
                    </button>
                    <span className="tnum text-[0.75rem]" style={{ color: 'var(--ink-secondary)' }}>
                      Page {query.page} of {pages.toLocaleString()}
                    </span>
                    <button type="button" className="btn btn-sm btn-pill" disabled={query.page >= pages} onClick={() => update({ page: query.page + 1 }, true)}>
                      Next →
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Desktop side panel */}
        <aside className="no-print hidden w-[400px] shrink-0 border-l lg:block xl:w-[480px] 2xl:w-[600px]" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }} aria-label="Posting details">
          {selected ? (
            <ListingDetail key={selected.id} listing={selected} onApply={onApply} onApplyTrack={onApplyTrack} onTrack={setTracking} onBookmark={onBookmark} onHide={onHide} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-[0.8125rem]" style={{ color: 'var(--ink-muted)' }}>
              {loading ? 'Loading…' : 'Select a job to see its requirements and match breakdown.'}
            </div>
          )}
        </aside>
      </div>

      {/* Mobile detail sheet */}
      {selected && mobileDetail ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Posting details">
          <div className="backdrop absolute inset-0" onClick={() => setMobileDetail(false)} />
          <div className="fade-in absolute inset-x-0 bottom-0 top-8 overflow-hidden rounded-t-3xl" style={{ background: 'var(--surface-1)', boxShadow: 'var(--shadow-lg)' }}>
            <ListingDetail listing={selected} onClose={() => setMobileDetail(false)} onApply={onApply} onApplyTrack={onApplyTrack} onTrack={setTracking} onBookmark={onBookmark} onHide={onHide} />
          </div>
        </div>
      ) : null}

      {/* Drawers */}
      {drawer ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={drawer === 'filters' ? 'All filters' : 'Quick copy'}>
          <div className="backdrop absolute inset-0" onClick={() => setDrawer(null)} />
          <div className="fade-in absolute inset-y-0 right-0 flex w-full max-w-sm flex-col" style={{ background: 'var(--surface-1)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-[0.9375rem] font-semibold">{drawer === 'filters' ? 'All filters' : 'Quick copy'}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawer(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {drawer === 'filters' ? <Filters query={query} facets={facets} onChange={update} onReset={reset} /> : <QuickCopy profile={profile} onCopied={(label) => setToast(`Copied ${label}.`)} />}
            </div>
          </div>
        </div>
      ) : null}

      {tracking ? <TrackDialog listing={tracking} onClose={() => setTracking(null)} onSaved={(id, status) => onTracked(tracking, id, status)} /> : null}

      {applyPrompt ? (
        <div className="no-print fade-in fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-[0.8125rem]" style={{ background: 'var(--surface-raised)', borderColor: 'var(--line-strong)', boxShadow: 'var(--shadow-lg)' }} role="dialog" aria-label="Did you apply?">
          <span>
            Did you apply to <strong>{applyPrompt.company}</strong>?
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => confirmApplied(applyPrompt)}>
            Yes, track it
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setApplyPrompt(null)}>
            Not yet
          </button>
        </div>
      ) : toast ? (
        <div className="no-print fade-in fixed bottom-5 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border px-4 py-2.5 text-[0.8125rem]" style={{ background: 'var(--surface-raised)', borderColor: 'var(--line-strong)', boxShadow: 'var(--shadow-lg)' }} role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg className="pointer-events-none absolute left-3" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden style={{ color: 'var(--ink-muted)' }}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      <p className="max-w-sm text-[0.8125rem]" style={{ color: 'var(--ink-secondary)' }}>
        {body}
      </p>
      {action}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="card p-4">
          <div className="flex gap-3">
            <div className="skeleton h-9 w-9 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
