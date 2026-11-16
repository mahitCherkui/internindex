/**
 * Local demo mode: `INTERNINDEX_DEMO=1 npm run dev`.
 *
 * Serves the search UI from a small in-memory catalog built from live public
 * ATS feeds, with a sample profile, so the interface can be previewed without
 * Supabase credentials. It never runs in production: `isDemo()` is false
 * whenever NODE_ENV is "production", whatever the flag says. Writes (save,
 * hide, track) are acknowledged but not stored.
 */
import { buildBreakdown } from './breakdown';
import { normalize, type NormalizedListing } from './parse';
import { toView } from './query';
import type { Facets, SearchQuery, SearchResult } from './search-query';
import { fetchSourceRaw } from './sources/registry';
import type { Internship, InternshipView, ProfileView } from './types';

/** Matches ORDER_BY.newest in query.ts: an undated posting ranks as if seen 3 days earlier. */
const UNDATED_PENALTY = 3 * 86_400;

export function isDemo(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.INTERNINDEX_DEMO === '1';
}

/**
 * A general mix, like the real catalog: broad community lists first, then
 * company boards across SWE, data, ML, product, fintech, consumer and one
 * quant firm, so no single field dominates the feed.
 */
const DEMO_SOURCES: [kind: string, token: string, label: string][] = [
  ['github', 'vansh-summer', 'vanshb03 Summer 2027'],
  ['github', 'speedy-swe', 'speedyapply'],
  ['github', 'speedy-ai', 'speedyapply AI'],
  ['github', 'jobbie-2027', 'jobbie'],
  ['greenhouse', 'stripe', 'Stripe'],
  ['greenhouse', 'robinhood', 'Robinhood'],
  ['greenhouse', 'coinbase', 'Coinbase'],
  ['greenhouse', 'databricks', 'Databricks'],
  ['greenhouse', 'datadog', 'Datadog'],
  ['greenhouse', 'figma', 'Figma'],
  ['greenhouse', 'pinterest', 'Pinterest'],
  ['greenhouse', 'roblox', 'Roblox'],
  ['greenhouse', 'imc', 'IMC Trading'],
  ['ashby', 'ramp', 'Ramp'],
  ['ashby', 'plaid', 'Plaid'],
  ['ashby', 'notion', 'Notion'],
  ['lever', 'palantir', 'Palantir'],
  ['hn', '-', 'Hacker News'],
];

/**
 * The demo profile starts empty, like a new account, and lives in memory for
 * the life of the dev server, so uploading a resume in the demo behaves the
 * way it does for a real user.
 */
/** Kept on globalThis so a dev-server hot reload doesn't wipe the demo session. */
const store = globalThis as unknown as {
  __demoUser?: ProfileView | null;
  __demoCatalog?: Promise<Internship[]> | null;
  __demoSaved?: Set<string>;
  __demoApplied?: Set<string>;
};
let demoUser: ProfileView | null = store.__demoUser ?? null;

export function demoProfile(): ProfileView {
  if (demoUser) return demoUser;
  const now = Math.floor(Date.now() / 1000);
  demoUser = store.__demoUser = {
    user_id: 'demo',
    name: null,
    email: null,
    school: null,
    major: null,
    minor: null,
    degree_level: null,
    class_year: null,
    grad_month: null,
    grad_year: null,
    gpa: null,
    work_auth: null,
    has_clearance: 0,
    skills_json: '[]',
    preferred_seasons_json: '[]',
    preferred_years_json: '[]',
    preferred_fields_json: '[]',
    preferred_locations_json: '[]',
    remote_pref: 'any',
    willing_to_relocate: 1,
    min_hourly: null,
    paid_only: 0,
    earliest_start: null,
    latest_start: null,
    resume_text: null,
    weekly_goal: 5,
    onboarded: 0,
    calendar_token: 'demo',
    created_at: now,
    updated_at: now,
    phone: null,
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    pronouns: null,
    quick_answers_json: '{}',
    digest_enabled: 1,
    digest_seen_at: null,
    skills: [],
    preferred_seasons: [],
    preferred_years: [],
    preferred_fields: [],
    preferred_locations: [],
    quick_answers: {},
    preferred_roles: [],
  };
  return demoUser;
}

/** Apply a profile PATCH to the in-memory demo profile (same keys as the real endpoint). */
export function updateDemoProfile(patch: Record<string, unknown>): ProfileView {
  // A new object each time, so per-profile caches (resume keywords) refresh.
  demoUser = store.__demoUser = { ...demoProfile(), ...(patch as Partial<ProfileView>), updated_at: Math.floor(Date.now() / 1000) };
  return demoUser;
}

/** In-memory saves for the demo session, so the Saved and Applied tabs have something to show. */
export const demoSaved = (store.__demoSaved ??= new Set<string>());
export const demoApplied = (store.__demoApplied ??= new Set<string>());

function toRow(l: NormalizedListing, now: number, index: number): Internship {
  // A posting's own date when it has one. Undated postings were already listed
  // when this catalog was built, so they count as older, never as new today.
  void index;
  const firstSeen = l.date_posted && l.date_posted < now ? l.date_posted : now - 14 * 86_400;
  return {
    id: l.id,
    source: l.source,
    source_kind: l.source_kind,
    source_id: l.source_id,
    company: l.company,
    company_slug: l.company_slug,
    company_url: l.company_url,
    title: l.title,
    normalized_title: l.normalized_title,
    apply_url: l.apply_url,
    description: l.description,
    locations_json: JSON.stringify(l.locations),
    primary_location: l.primary_location,
    city: l.city,
    region: l.region,
    country: l.country,
    location_type: l.location_type,
    is_remote: l.is_remote,
    season: l.season,
    year: l.year,
    terms_json: JSON.stringify(l.terms),
    start_date: l.start_date,
    end_date: l.end_date,
    duration_weeks: l.duration_weeks,
    deadline: l.deadline,
    field: l.field,
    role_family: l.role_family,
    program_type: l.program_type,
    degrees_json: JSON.stringify(l.degrees),
    class_years_json: JSON.stringify(l.class_years),
    gpa_min: l.gpa_min,
    sponsorship: l.sponsorship,
    offers_sponsorship: l.offers_sponsorship,
    requires_citizenship: l.requires_citizenship,
    requires_clearance: l.requires_clearance,
    requires_cover_letter: l.requires_cover_letter,
    requires_transcript: l.requires_transcript,
    requires_portfolio: l.requires_portfolio,
    skills_json: JSON.stringify(l.skills),
    tags_json: JSON.stringify(l.tags),
    is_paid: l.is_paid,
    salary_min: l.salary_min,
    salary_max: l.salary_max,
    salary_period: l.salary_period,
    salary_currency: l.salary_currency,
    comp_text: l.comp_text,
    status: 'open',
    is_open: 1,
    close_reason: null,
    closed_at: null,
    first_seen_at: firstSeen,
    last_seen_at: now,
    date_posted: l.date_posted,
    date_updated: l.date_updated,
    link_status: null,
    link_checked_at: null,
    dedupe_key: l.dedupe_key,
    duplicate_of: null,
    quality: l.quality,
    raw_json: null,
    seen_sources_json: '[]',
    keywords_json: JSON.stringify(l.keywords),
    grad_year_min: l.grad_year_min,
    grad_year_max: l.grad_year_max,
    majors_json: JSON.stringify(l.majors),
    underclass_ok: l.underclass_ok,
  };
}

async function loadCatalog(): Promise<Internship[]> {
  const now = Math.floor(Date.now() / 1000);
  const batches = await Promise.all(
    DEMO_SOURCES.map(([kind, token, label]) => fetchSourceRaw(kind, token, label).catch(() => [])),
  );
  const seen = new Set<string>();
  const rows: Internship[] = [];
  let i = 0;
  for (const raw of batches.flat()) {
    const listing = normalize(raw);
    if (!listing || seen.has(listing.dedupe_key)) continue;
    seen.add(listing.dedupe_key);
    rows.push(toRow(listing, now, i++));
  }
  return rows;
}

const CATALOG_KEY = DEMO_SOURCES.map((x) => x.join(':')).join('|');

function getCatalog(): Promise<Internship[]> {
  const keyed = store as typeof store & { __demoCatalogKey?: string };
  if (keyed.__demoCatalogKey !== CATALOG_KEY) {
    keyed.__demoCatalogKey = CATALOG_KEY;
    store.__demoCatalog = null;
  }
  store.__demoCatalog ??= loadCatalog().catch((err) => {
    store.__demoCatalog = null;
    throw err;
  });
  return store.__demoCatalog;
}

function matches(row: Internship, view: InternshipView, q: SearchQuery, now: number): boolean {
  if (q.q) {
    const hay = `${row.title} ${row.company} ${row.skills_json}`.toLowerCase();
    if (!q.q.toLowerCase().split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  if (q.roleFamilies.length && !q.roleFamilies.includes(row.role_family)) return false;
  if (q.fields.length && !q.fields.includes(row.field)) return false;
  if (q.seasons.length && !q.seasons.includes(row.season)) return false;
  if (q.locationTypes.length && !q.locationTypes.includes(row.location_type)) return false;
  if (q.sponsorship.length && !q.sponsorship.includes(row.sponsorship)) return false;
  if (q.classYears.length && view.class_years.length && !q.classYears.some((c) => view.class_years.includes(c))) return false;
  if (q.sources.length && !q.sources.some((s) => row.source.startsWith(s))) return false;
  if (q.newToday && (row.date_posted ?? row.first_seen_at - UNDATED_PENALTY) < now - 86_400) return false;
  if (q.underclass && view.underclass_ok === 0) return false;
  if (q.minMatch != null && (view.match?.score ?? 0) < q.minMatch) return false;
  if (q.paidOnly && !row.salary_min && row.is_paid !== 1) return false;
  if (q.bookmarkedOnly && !demoSaved.has(row.id)) return false;
  if (q.appliedOnly && !demoApplied.has(row.id)) return false;
  return true;
}

export async function demoSearch(q: SearchQuery): Promise<SearchResult> {
  const profile = demoProfile();
  const now = Math.floor(Date.now() / 1000);
  const rows = await getCatalog();
  let views = rows
    .map((row) => ({ row, view: demoState(toView(row, profile)) }))
    .filter(({ row, view }) => matches(row, view, q, now));

  const age = (r: Internship) => r.date_posted ?? r.first_seen_at;
  const newestKey = (r: Internship) => r.date_posted ?? r.first_seen_at - UNDATED_PENALTY;
  views.sort((a, b) => {
    switch (q.sort) {
      case 'match':
        return (b.view.match?.score ?? -1) - (a.view.match?.score ?? -1);
      case 'recommended':
        return (b.view.recommend ?? -1) - (a.view.recommend ?? -1) || age(b.row) - age(a.row);
      case 'fit':
        return (b.view.fit?.score ?? 0) - (a.view.fit?.score ?? 0);
      case 'deadline':
        return (a.row.deadline ?? Infinity) - (b.row.deadline ?? Infinity);
      case 'pay':
        return (b.row.salary_min ?? 0) - (a.row.salary_min ?? 0);
      case 'company':
        return a.row.company.localeCompare(b.row.company);
      default:
        return newestKey(b.row) - newestKey(a.row);
    }
  });
  const total = views.length;
  views = views.slice((q.page - 1) * q.limit, q.page * q.limit);
  return { rows: views.map((v) => v.view), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) };
}

function demoState(view: InternshipView): InternshipView {
  return {
    ...view,
    bookmarked: demoSaved.has(view.id),
    applied: demoApplied.has(view.id),
    application_id: demoApplied.has(view.id) ? 1 : null,
    application_status: demoApplied.has(view.id) ? 'applied' : null,
  };
}

export async function demoFacets(): Promise<Facets> {
  const rows = await getCatalog();
  const count = (key: (r: Internship) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: value, count: n }));
  };
  return {
    seasons: count((r) => r.season),
    years: count((r) => (r.year ? String(r.year) : null)),
    fields: count((r) => r.field),
    roleFamilies: count((r) => r.role_family),
    programTypes: count((r) => r.program_type),
    locationTypes: count((r) => r.location_type),
    countries: count((r) => r.country),
    regions: count((r) => r.region),
    sponsorship: count((r) => r.sponsorship),
    degrees: [],
    classYears: [],
    companies: count((r) => r.company_slug).slice(0, 60),
    skills: [],
    sources: count((r) => r.source.split(':')[0]),
    total: rows.length,
  };
}

export async function demoDetail(id: string) {
  const rows = await getCatalog();
  let row = rows.find((r) => r.id === id);
  if (!row) return null;
  // Same on-open enrichment as the real detail route, kept in memory.
  if (!row.description || row.description.length < 200) {
    const { enrichRow } = await import('./sync');
    const result = await Promise.race([enrichRow(row), new Promise<null>((r) => setTimeout(() => r(null), 8000))]).catch(() => null);
    if (result) {
      const next = toRow(result.listing, Math.floor(Date.now() / 1000), 0);
      next.first_seen_at = row.first_seen_at;
      rows[rows.indexOf(row)] = next;
      row = next;
    }
  }
  const profile = demoProfile();
  const view = demoState(toView(row, profile));
  return { ...view, breakdown: buildBreakdown(view, profile) };
}
