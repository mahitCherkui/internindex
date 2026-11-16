import { exec, jsonArray, nowSec, one, q } from './db';
import { normalize, type NormalizedListing, type RawListing } from './parse';
import { fetchSourceRaw } from './sources/registry';
import { NO_FETCH_HOSTS } from './no-fetch';
import { enrichFromUrl } from './sources/enrich';
import { fetchPhenom } from './sources/phenom';
import { isPartial } from './sources/partial';
import { employerKey, probeMuseEmployers } from './sources/muse-discovery';
import { checkLink, mapPool } from './sources/http';
import { boardFromUrl, fallbackLabel, SEED_BOARDS, SEED_FEEDS } from './sources/seed';
import { DAY } from './util';

/**
 * How long a listing may go unseen before we stop trusting that it's open.
 * Aggregator feeds occasionally drop entries transiently, so this is generous.
 */
const STALE_UNSEEN_DAYS = 21;
/** A posting this old with no update is almost certainly filled. */
const STALE_POSTED_DAYS = 150;
/**
 * How far past its start date a term may be before we stop showing it. Sources
 * sometimes keep old cycles listed as active; you cannot apply to an internship
 * that began three months ago.
 */
const TERM_PASSED_DAYS = 90;
/**
 * How long a closed listing is kept before it is deleted. Closed rows are never
 * shown in search, and keeping them forever grew the catalog past the hosting
 * plan's database quota, which made the database read-only and broke sign-in.
 */
const CLOSED_RETENTION_DAYS = 30;

export interface SourceRow {
  id: number;
  kind: string;
  token: string;
  label: string;
  enabled: number;
  last_sync_at: number | null;
  last_count: number | null;
  last_error: string | null;
}

export interface SourceOutcome {
  source: string;
  kind: string;
  token: string;
  label: string;
  ok: boolean;
  fetched: number;
  internships: number;
  error?: string;
  ms: number;
}

export interface SyncResult {
  runId: number;
  ok: boolean;
  found: number;
  inserted: number;
  updated: number;
  reopened: number;
  closed: number;
  skipped: number;
  duplicates: number;
  discovered: number;
  durationMs: number;
  sources: SourceOutcome[];
  errors: string[];
}

export interface SyncOptions {
  /** Restrict to these source kinds. */
  kinds?: string[];
  /** Restrict to a specific "kind:token". */
  only?: string[];
  /** Max sources fetched in parallel. */
  concurrency?: number;
  /** Skip the ATS auto-discovery step. */
  noDiscover?: boolean;
  /** How the run was started, for the audit log. */
  trigger?: string;
  /** Cap on ATS boards touched in one run (keeps a manual sync quick). */
  maxBoards?: number;
  /**
   * A run that must fit a serverless time limit: The Muse gets a small request
   * budget (its full sweep takes minutes) and no employer page probes.
   */
  light?: boolean;
  /** Postings without a description to enrich from their apply page this run. */
  enrich?: number;
  onProgress?: (message: string) => void;
}

/** Insert the built-in sources on first run. */
export async function ensureSeedSources(): Promise<void> {
  const all = [...SEED_FEEDS, ...SEED_BOARDS];
  const now = nowSec();
  await exec(
    `INSERT INTO source_configs (kind, token, label, enabled, created_at)
     SELECT kind, token, label, 1, ?
     FROM unnest(?::text[], ?::text[], ?::text[]) AS s(kind, token, label)
     ON CONFLICT (kind, token) DO NOTHING`,
    [now, all.map((s) => s.kind), all.map((s) => s.token), all.map((s) => s.label)],
  );
  // Feed labels name the cycle they read ("Summer 2027"), so keep them current
  // when a feed rolls over to a new year's list under the same token.
  await exec(
    `UPDATE source_configs sc SET label = s.label
     FROM unnest(?::text[], ?::text[], ?::text[]) AS s(kind, token, label)
     WHERE sc.kind = s.kind AND sc.token = s.token AND sc.label <> s.label`,
    [SEED_FEEDS.map((s) => s.kind), SEED_FEEDS.map((s) => s.token), SEED_FEEDS.map((s) => s.label)],
  );
}

async function listSources(opts: SyncOptions): Promise<SourceRow[]> {
  let rows = await q<SourceRow>(
    'SELECT * FROM source_configs WHERE enabled = 1 ORDER BY kind, token',
  );

  if (opts.kinds?.length) rows = rows.filter((r) => opts.kinds!.includes(r.kind));
  if (opts.only?.length) {
    const wanted = new Set(opts.only);
    rows = rows.filter((r) => wanted.has(`${r.kind}:${r.token}`) || wanted.has(r.kind));
  }

  if (opts.maxBoards != null) {
    const feeds = rows.filter((r) => !isBoardKind(r.kind));
    const boards = rows.filter((r) => isBoardKind(r.kind));

    // Prefer boards we haven't synced in the longest time...
    boards.sort((a, b) => (a.last_sync_at ?? 0) - (b.last_sync_at ?? 0));

    // ...but round-robin across providers so one capped run samples every ATS
    // rather than exhausting whichever kind sorts first alphabetically.
    const byKind = new Map<string, SourceRow[]>();
    for (const board of boards) {
      const bucket = byKind.get(board.kind) ?? [];
      bucket.push(board);
      byKind.set(board.kind, bucket);
    }
    const queues = [...byKind.values()];
    const picked: SourceRow[] = [];
    for (let i = 0; picked.length < opts.maxBoards && queues.some((queue) => queue.length > i); i++) {
      for (const queue of queues) {
        if (picked.length >= opts.maxBoards) break;
        if (queue.length > i) picked.push(queue[i]);
      }
    }

    rows = [...feeds, ...picked];
  }

  return rows;
}

/** Sources that belong to one employer, as opposed to a cross-company feed. */
const BOARD_KINDS = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workable',
  'workday',
  'oracle',
  'phenom',
  'eightfold',
  'rippling',
  'bamboohr',
  'breezy',
  'personio',
  'jibe',
  'recruitee',
  'gem',
]);

function isBoardKind(kind: string): boolean {
  return BOARD_KINDS.has(kind);
}

function fetchSource(row: SourceRow, opts: SyncOptions = {}): Promise<RawListing[]> {
  return fetchSourceRaw(row.kind, row.token, row.label, { light: opts.light });
}

/**
 * Run a full sync: fetch every enabled source, normalize, upsert, and reconcile
 * which listings are still open.
 */
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  await ensureSeedSources();

  const startedAt = nowSec();
  const t0 = Date.now();
  const log = opts.onProgress ?? (() => {});

  const runRow = await one<{ id: number }>(
    'INSERT INTO sync_runs (started_at, trigger) VALUES (?, ?) RETURNING id',
    [startedAt, opts.trigger ?? 'manual'],
  );
  const runId = runRow!.id;

  const sources = await listSources(opts);
  log(`Syncing ${sources.length} source${sources.length === 1 ? '' : 's'}…`);

  const outcomes: SourceOutcome[] = [];
  const errors: string[] = [];
  /** Listings keyed by source, so we only reconcile sources that succeeded. */
  const bySource = new Map<string, NormalizedListing[]>();
  /** Apply URLs plus the employer name the feed gave us, for board discovery. */
  const seenUrls: { url: string; company?: string }[] = [];
  /** Muse postings, whose pages reveal the employer's own board. */
  const musePostings: { company: string; applyUrl: string }[] = [];
  /** Sources that returned only part of what they carry, so absence proves nothing. */
  const partialSources = new Set<string>();

  await mapPool(sources, opts.concurrency ?? 6, async (row) => {
    const startMs = Date.now();
    const sourceKey = `${row.kind}:${row.token}`;
    try {
      const raw = await fetchSource(row, opts);
      if (row.kind === 'muse') {
        for (const item of raw) musePostings.push({ company: item.company, applyUrl: item.applyUrl });
      }
      const partial = isPartial(raw);
      if (partial) partialSources.add(sourceKeyForRow(row));
      const listings: NormalizedListing[] = [];
      for (const item of raw) {
        // Only aggregator feeds carry a trustworthy employer name for a board
        // they don't own; an ATS reporting its own slug adds nothing.
        seenUrls.push({
          url: item.applyUrl,
          company: row.kind === 'github' || row.kind === 'hn' ? item.company : undefined,
        });
        const normalized = normalize(item);
        if (normalized) listings.push(normalized);
      }

      // Group by the source string the adapter actually emitted, since
      // aggregator feeds carry their own per-source identity.
      for (const listing of listings) {
        if (partial) partialSources.add(listing.source);
        const bucket = bySource.get(listing.source) ?? [];
        bucket.push(listing);
        bySource.set(listing.source, bucket);
      }
      // Register the source even when it produced nothing, so reconciliation
      // can close everything it used to carry.
      if (listings.length === 0) {
        const emitted = sourceKeyForRow(row);
        if (!bySource.has(emitted)) bySource.set(emitted, []);
      }

      await exec(
        'UPDATE source_configs SET last_sync_at = ?, last_count = ?, last_error = NULL WHERE id = ?',
        [nowSec(), listings.length, row.id],
      );

      outcomes.push({
        source: sourceKey,
        kind: row.kind,
        token: row.token,
        label: row.label,
        ok: true,
        fetched: raw.length,
        internships: listings.length,
        ms: Date.now() - startMs,
      });
      log(`  ${row.label}: ${listings.length} internships from ${raw.length} postings`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await exec('UPDATE source_configs SET last_sync_at = ?, last_error = ? WHERE id = ?', [
        nowSec(),
        message.slice(0, 400),
        row.id,
      ]);
      outcomes.push({
        source: sourceKey,
        kind: row.kind,
        token: row.token,
        label: row.label,
        ok: false,
        fetched: 0,
        internships: 0,
        error: message,
        ms: Date.now() - startMs,
      });
      errors.push(`${sourceKey}: ${message}`);
      log(`  ${row.label}: FAILED: ${message}`);
    }
  });

  // ---- Upsert everything we found. ----
  const all = [...bySource.values()].flat();
  const { inserted, updated, reopened, skipped } = await upsertListings(all);

  // ---- Close listings that vanished from a source that synced cleanly. ----
  // A partial read (a page cap or request budget ran out) is skipped: what it
  // did not reach is unread, not delisted. The unseen sweep covers those.
  const healthySources = [...bySource.keys()].filter((source) => !partialSources.has(source));
  if (partialSources.size) log(`Skipping delisting for ${partialSources.size} partially read source(s).`);
  const closed = await reconcileOpenness(bySource, healthySources);

  // ---- Fill in descriptions the feeds didn't carry. ----
  if (opts.enrich && opts.enrich > 0) {
    const e = await enrichPending(opts.enrich, { concurrency: 8 });
    log(`Enriched ${e.enriched} of ${e.tried} postings with their full description (${Object.entries(e.via).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}).`);
  }

  // ---- Lifecycle sweep + dedupe. ----
  const expired = await sweepLifecycle();
  const duplicates = await markDuplicates();

  // ---- Learn about new employers from the URLs we just saw. ----
  let discovered = 0;
  if (!opts.noDiscover) {
    discovered = await discoverBoards(seenUrls);
    if (musePostings.length && !opts.light) {
      const fromMuse = await discoverFromMuse(musePostings);
      if (fromMuse > 0) log(`Learned ${fromMuse} employer board(s) from Muse posting pages.`);
      discovered += fromMuse;
    }
    if (discovered > 0) log(`Discovered ${discovered} new company job board(s) for future syncs.`);
  }

  const durationMs = Date.now() - t0;
  const ok = outcomes.length > 0 && outcomes.some((o) => o.ok);

  await exec(
    `UPDATE sync_runs SET finished_at = ?, ok = ?, found = ?, inserted = ?, updated = ?,
        closed = ?, skipped = ?, duration_ms = ?, sources_json = ?, errors_json = ?
     WHERE id = ?`,
    [
      nowSec(),
      ok ? 1 : 0,
      all.length,
      inserted,
      updated,
      closed + expired,
      skipped,
      durationMs,
      JSON.stringify(outcomes),
      JSON.stringify(errors),
      runId,
    ],
  );

  return {
    runId,
    ok,
    found: all.length,
    inserted,
    updated,
    reopened,
    closed: closed + expired,
    skipped,
    duplicates,
    discovered,
    durationMs,
    sources: outcomes,
    errors,
  };
}

/** Muse posting pages opened per sync, one per employer the catalog lacks. */
const MUSE_PROBES_PER_RUN = 80;

/**
 * Register the boards of Muse employers the catalog has no board for yet.
 * Employers are matched by name against existing board labels, and discovery
 * labels what it finds with the Muse employer name, so an employer probed
 * successfully once is skipped from then on.
 */
async function discoverFromMuse(postings: { company: string; applyUrl: string }[]): Promise<number> {
  const labels = await q<{ label: string }>('SELECT label FROM source_configs');
  const known = new Set(labels.map((r) => employerKey(r.label)));
  const probes = await probeMuseEmployers(postings, known, { max: MUSE_PROBES_PER_RUN });
  const seen: { url: string; company: string }[] = [];
  for (const probe of probes) {
    for (const url of probe.urls) {
      const board = boardFromUrl(url);
      // Phenom is recognized by URL shape alone, and plenty of branded careers
      // sites share that shape without running Phenom. Nothing disables a board
      // that keeps failing, so only register one that actually answers.
      if (board?.kind === 'phenom') {
        try {
          await fetchPhenom(board.token, probe.company);
        } catch {
          continue;
        }
      }
      seen.push({ url, company: probe.company });
    }
  }
  return discoverBoards(seen);
}

/** Singleton feeds emit a bare kind as their source string; boards emit "kind:token". */
const SINGLETON_KINDS = new Set([
  'hn',
  'janestreet',
  'remoteok',
  'arbeitnow',
  'jobicy',
  'amazon',
  'muse',
  'orise',
  'usajobs',
]);

function sourceKeyForRow(row: SourceRow): string {
  if (SINGLETON_KINDS.has(row.kind)) return row.kind;
  return `${row.kind}:${row.token}`;
}

interface UpsertCounts {
  inserted: number;
  updated: number;
  reopened: number;
  skipped: number;
}

/** Column list shared by the bulk-upsert statement and its record definition. */
const UPSERT_COLUMNS: [name: string, pgType: string][] = [
  ['id', 'text'], ['source', 'text'], ['source_kind', 'text'], ['source_id', 'text'],
  ['company', 'text'], ['company_slug', 'text'], ['company_url', 'text'], ['title', 'text'],
  ['normalized_title', 'text'], ['apply_url', 'text'], ['description', 'text'],
  ['locations_json', 'text'], ['primary_location', 'text'], ['city', 'text'], ['region', 'text'],
  ['country', 'text'], ['location_type', 'text'], ['is_remote', 'smallint'], ['season', 'text'],
  ['year', 'integer'], ['terms_json', 'text'], ['start_date', 'bigint'], ['end_date', 'bigint'],
  ['duration_weeks', 'integer'], ['deadline', 'bigint'], ['field', 'text'], ['role_family', 'text'],
  ['program_type', 'text'], ['degrees_json', 'text'], ['class_years_json', 'text'],
  ['gpa_min', 'double precision'], ['sponsorship', 'text'], ['offers_sponsorship', 'smallint'],
  ['requires_citizenship', 'smallint'], ['requires_clearance', 'smallint'],
  ['requires_cover_letter', 'smallint'], ['requires_transcript', 'smallint'],
  ['requires_portfolio', 'smallint'], ['skills_json', 'text'], ['tags_json', 'text'],
  ['is_paid', 'smallint'], ['salary_min', 'double precision'], ['salary_max', 'double precision'],
  ['salary_period', 'text'], ['salary_currency', 'text'], ['comp_text', 'text'],
  ['status', 'text'], ['is_open', 'smallint'], ['first_seen_at', 'bigint'],
  ['last_seen_at', 'bigint'], ['date_posted', 'bigint'], ['date_updated', 'bigint'],
  ['dedupe_key', 'text'], ['quality', 'double precision'],
  ['keywords_json', 'text'], ['grad_year_min', 'smallint'], ['grad_year_max', 'smallint'],
  ['majors_json', 'text'], ['underclass_ok', 'smallint'],
];

/** Columns whose new value should only overwrite when the new value is present. */
const COALESCE_ON_UPDATE = new Set(['company_url', 'description', 'date_posted']);
/** Columns never touched on update. */
const INSERT_ONLY = new Set(['id', 'first_seen_at']);

const UPSERT_SQL = (() => {
  const names = UPSERT_COLUMNS.map(([n]) => n);
  const recordDef = UPSERT_COLUMNS.map(([n, t]) => `${n} ${t}`).join(', ');
  const updates = names
    .filter((n) => !INSERT_ONLY.has(n))
    .map((n) =>
      COALESCE_ON_UPDATE.has(n)
        ? `${n} = COALESCE(EXCLUDED.${n}, internships.${n})`
        : `${n} = EXCLUDED.${n}`,
    );
  // Reopening clears the closed markers; closing keeps whatever reason applies.
  updates.push(
    'close_reason = CASE WHEN EXCLUDED.is_open = 1 THEN NULL ELSE internships.close_reason END',
    'closed_at = CASE WHEN EXCLUDED.is_open = 1 THEN NULL ELSE internships.closed_at END',
  );
  return `
    INSERT INTO internships (${names.join(', ')})
    SELECT ${names.map((n) => `r.${n}`).join(', ')}
    FROM jsonb_to_recordset(?::jsonb) AS r(${recordDef})
    ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}
    RETURNING id, (xmax = 0) AS was_insert
  `;
})();

/**
 * Insert new listings and refresh existing ones in bulk, one statement per
 * chunk, which matters when the database is across the network.
 *
 * A listing seen again is always marked open: reappearing on a live board is
 * evidence the role is accepting applications again.
 */
export async function upsertListings(listings: NormalizedListing[]): Promise<UpsertCounts> {
  const now = nowSec();
  let inserted = 0;
  let updated = 0;
  let reopened = 0;
  let skipped = 0;

  // The same listing can appear twice in one run (e.g. two aggregator entries
  // resolving to one id); a single multi-row upsert cannot touch a row twice.
  const byId = new Map<string, NormalizedListing>();
  for (const listing of listings) byId.set(listing.id, listing);
  const unique = [...byId.values()];

  // A posting with no date of its own that newly appears on a feed we've read
  // before was really just posted, so it gets this moment as its date. On a
  // feed's first read everything is a backlog, and stays undated.
  const undatedSources = [...new Set(unique.filter((l) => l.date_posted == null).map((l) => l.source))];
  const knownSources = new Set(
    undatedSources.length
      ? (
          await q<{ source: string }>(
            `SELECT s.source FROM unnest(?::text[]) AS s(source)
             WHERE EXISTS (SELECT 1 FROM internships i WHERE i.source = s.source AND i.first_seen_at < ?)`,
            [undatedSources, now - 3600],
          )
        ).map((r) => r.source)
      : [],
  );

  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const ids = chunk.map((l) => l.id);

    const existing = new Map(
      (
        await q<{ id: string; is_open: number }>(
          'SELECT id, is_open FROM internships WHERE id = ANY(?)',
          [ids],
        )
      ).map((r) => [r.id, r.is_open]),
    );

    const batch: Record<string, unknown>[] = [];
    for (const listing of chunk) {
      const prior = existing.get(listing.id);
      if (prior === undefined && !listing.active) {
        // A listing whose source already says it's inactive is not worth storing.
        skipped++;
        continue;
      }
      if (prior === 0 && listing.active) reopened++;
      const params = toParams(listing, now);
      if (prior === undefined && listing.date_posted == null && knownSources.has(listing.source)) {
        params.date_posted = now;
      }
      batch.push(params);
    }
    if (batch.length === 0) continue;

    const results = await q<{ id: string; was_insert: boolean }>(UPSERT_SQL, [
      JSON.stringify(batch),
    ]);
    for (const row of results) {
      if (row.was_insert) inserted++;
      else updated++;
    }
  }

  return { inserted, updated, reopened, skipped };
}

function toParams(l: NormalizedListing, now: number): Record<string, unknown> {
  const open = l.active ? 1 : 0;
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
    status: open ? 'open' : 'closed',
    is_open: open,
    first_seen_at: now,
    last_seen_at: now,
    date_posted: l.date_posted,
    date_updated: l.date_updated,
    dedupe_key: l.dedupe_key,
    quality: l.quality,
    keywords_json: JSON.stringify(l.keywords),
    grad_year_min: l.grad_year_min,
    grad_year_max: l.grad_year_max,
    majors_json: JSON.stringify(l.majors),
    underclass_ok: l.underclass_ok,
  };
}

/**
 * Close listings that a healthy source no longer carries.
 *
 * Only sources that fetched successfully in this run are reconciled, because a network
 * failure must never be read as "this employer closed every role".
 */
export async function reconcileOpenness(
  bySource: Map<string, NormalizedListing[]>,
  healthySources: string[],
): Promise<number> {
  if (healthySources.length === 0) return 0;
  const now = nowSec();
  let closed = 0;

  for (const source of healthySources) {
    const seen = (bySource.get(source) ?? []).map((l) => l.id);
    closed += await exec(
      `UPDATE internships SET is_open = 0, status = 'closed', close_reason = 'delisted', closed_at = ?
       WHERE source = ? AND is_open = 1 AND NOT (id = ANY(?))`,
      [now, source, seen],
    );
  }
  return closed;
}

/**
 * Close listings on time-based signals: a passed deadline, a long absence, or
 * an ancient posting date. This is the safety net for sources whose feeds go
 * quiet without formally delisting anything.
 */
export async function sweepLifecycle(): Promise<number> {
  const now = nowSec();
  let count = 0;

  count += await exec(
    `UPDATE internships SET is_open = 0, status = 'expired', close_reason = 'deadline-passed', closed_at = ?
     WHERE is_open = 1 AND deadline IS NOT NULL AND deadline < ?`,
    [now, now - DAY],
  );

  count += await exec(
    `UPDATE internships SET is_open = 0, status = 'closed', close_reason = 'stale', closed_at = ?
     WHERE is_open = 1 AND last_seen_at < ? AND source <> 'import'`,
    [now, now - STALE_UNSEEN_DAYS * DAY],
  );

  count += await exec(
    `UPDATE internships SET is_open = 0, status = 'closed', close_reason = 'stale', closed_at = ?
     WHERE is_open = 1 AND date_posted IS NOT NULL AND date_posted < ?
       AND (date_updated IS NULL OR date_updated < ?)`,
    [now, now - STALE_POSTED_DAYS * DAY, now - STALE_POSTED_DAYS * DAY],
  );

  // A term whose start is well behind us can't be applied to, even if the
  // source still flags it active, e.g. a "Spring 2025" listing seen in 2026.
  count += await exec(
    `UPDATE internships SET is_open = 0, status = 'expired', close_reason = 'term-passed', closed_at = ?
     WHERE is_open = 1 AND start_date IS NOT NULL AND start_date < ?`,
    [now, now - TERM_PASSED_DAYS * DAY],
  );

  await pruneClosed(now);
  return count;
}

/**
 * Delete listings that have been closed for a while, so the table holds roughly
 * what is open instead of everything ever seen. A row someone applied to,
 * bookmarked, or hid is kept: their tracker still links to it.
 */
/**
 * Database size past which closed listings are deleted at once instead of
 * after CLOSED_RETENTION_DAYS. Supabase's free plan turns the database
 * read-only at 500 MB, which takes sign-in and the whole site down with it, so
 * near the cap the archive of closed roles gives way to the live catalog.
 */
const DB_SOFT_LIMIT_MB = Number(process.env.DB_SOFT_LIMIT_MB) || 440;

async function pruneClosed(now: number): Promise<number> {
  const size = await one<{ bytes: string }>('SELECT pg_database_size(current_database())::text AS bytes');
  const tight = Number(size?.bytes ?? 0) > DB_SOFT_LIMIT_MB * 1024 * 1024;
  const retentionDays = tight ? 0 : CLOSED_RETENTION_DAYS;
  return exec(
    `DELETE FROM internships i
     WHERE i.is_open = 0 AND i.closed_at IS NOT NULL AND i.closed_at < ?
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.internship_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM bookmarks b WHERE b.internship_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM hidden_listings h WHERE h.internship_id = i.id)`,
    [now - retentionDays * DAY],
  );
}

interface DupeRow {
  id: string;
  dedupe_key: string;
  source: string;
  source_kind: string;
  quality: number;
  date_posted: number | null;
  first_seen_at: number;
  has_desc: number;
  season: string;
  year: number | null;
  city: string | null;
  country: string | null;
  is_remote: number;
  seen_sources_json: string;
  duplicate_of: string | null;
  company_url: string | null;
}

/**
 * Two postings with the same company and title are the same role only when
 * their terms and places agree. A missing value on either side is treated as
 * agreement, because aggregators routinely omit what the ATS states.
 */
export function sameRole(
  a: Pick<DupeRow, 'season' | 'year' | 'city' | 'country' | 'is_remote'>,
  b: Pick<DupeRow, 'season' | 'year' | 'city' | 'country' | 'is_remote'>,
): boolean {
  const known = (s: string) => s && s !== 'Unknown';
  if (known(a.season) && known(b.season) && a.season !== b.season) return false;
  if (a.year != null && b.year != null && a.year !== b.year) return false;
  if (a.is_remote && b.is_remote) return true;
  if (a.city && b.city) return a.city.toLowerCase() === b.city.toLowerCase();
  if (a.country && b.country && a.country !== b.country) return false;
  return true;
}

/**
 * Collapse the same role found on multiple sources down to one canonical row.
 *
 * Postings are grouped by normalized company + title (the dedupe key) and
 * then clustered by compatible term and location. The canonical row is the
 * company's own ATS copy when there is one (its apply link is the real
 * application page), then the most complete, then the most recently posted.
 * It inherits the earliest first_seen_at in its cluster, so "new today" means
 * new to every source, and records every source the role was seen on.
 */
export async function markDuplicates(): Promise<number> {
  // Only rows whose duplicate link actually changes are written. Every write
  // re-indexes the whole row for full-text search, so rewriting every open
  // row each run ran past the statement timeout and failed the sync.
  const rows = await q<DupeRow>(
    `SELECT id, dedupe_key, source, source_kind, quality, date_posted, first_seen_at,
            season, year, city, country, is_remote, seen_sources_json, duplicate_of, company_url,
            CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END AS has_desc
     FROM internships
     WHERE is_open = 1 AND dedupe_key <> ''
       AND dedupe_key IN (
         SELECT dedupe_key FROM internships
         WHERE is_open = 1 AND dedupe_key <> ''
         GROUP BY dedupe_key HAVING COUNT(*) > 1
       )`,
  );

  const groups = new Map<string, DupeRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.dedupe_key) ?? [];
    bucket.push(row);
    groups.set(row.dedupe_key, bucket);
  }

  const rank = (kind: string) => (kind === 'ats' ? 2 : kind === 'aggregator' ? 1 : 0);
  const pairs: { id: string; winner: string }[] = [];
  const winners: { id: string; first_seen_at: number; seen_sources_json: string; company_url: string | null }[] = [];

  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        rank(b.source_kind) - rank(a.source_kind) ||
        b.has_desc - a.has_desc ||
        b.quality - a.quality ||
        (b.date_posted ?? 0) - (a.date_posted ?? 0) ||
        a.id.localeCompare(b.id),
    );

    // Greedy clustering: each row joins the first cluster whose canonical row
    // it is compatible with, or starts its own.
    const clusters: DupeRow[][] = [];
    for (const row of group) {
      const home = clusters.find((cluster) => sameRole(cluster[0], row));
      if (home) home.push(row);
      else clusters.push([row]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const [winner, ...losers] = cluster;
      for (const loser of losers) pairs.push({ id: loser.id, winner: winner.id });

      const sources = new Set<string>();
      for (const member of cluster) {
        sources.add(member.source);
        for (const s of jsonArray(member.seen_sources_json)) sources.add(s);
      }
      const merged = JSON.stringify([...sources].sort());
      const earliest = Math.min(...cluster.map((m) => m.first_seen_at));
      // The ATS copy rarely knows the employer's homepage; an aggregator copy often does.
      const homepage = winner.company_url ?? cluster.find((m) => m.company_url && !/simplify\.jobs/.test(m.company_url))?.company_url ?? null;
      if (merged !== winner.seen_sources_json || earliest !== winner.first_seen_at || homepage !== winner.company_url) {
        winners.push({ id: winner.id, first_seen_at: earliest, seen_sources_json: merged, company_url: homepage });
      }
    }
  }

  // Release open rows that are no longer anyone's duplicate, e.g. because the
  // winner closed, so they can represent the role again.
  await exec(
    `UPDATE internships SET duplicate_of = NULL
     WHERE is_open = 1 AND duplicate_of IS NOT NULL AND NOT (id = ANY(?::text[]))`,
    [pairs.map((p) => p.id)],
  );

  for (let i = 0; i < pairs.length; i += 2000) {
    const chunk = pairs.slice(i, i + 2000);
    await exec(
      `UPDATE internships i SET duplicate_of = m.winner
       FROM jsonb_to_recordset(?::jsonb) AS m(id text, winner text)
       WHERE i.id = m.id AND i.duplicate_of IS DISTINCT FROM m.winner`,
      [JSON.stringify(chunk)],
    );
  }

  for (let i = 0; i < winners.length; i += 2000) {
    const chunk = winners.slice(i, i + 2000);
    await exec(
      `UPDATE internships i SET first_seen_at = m.first_seen_at, seen_sources_json = m.seen_sources_json,
              company_url = COALESCE(i.company_url, m.company_url)
       FROM jsonb_to_recordset(?::jsonb) AS m(id text, first_seen_at bigint, seen_sources_json text, company_url text)
       WHERE i.id = m.id`,
      [JSON.stringify(chunk)],
    );
  }

  return pairs.length;
}

/**
 * Read apply URLs from this run and register any ATS board we don't track yet.
 * This is how the catalog grows past the seed list on its own.
 *
 * The employer name is carried alongside the URL because some ATS APIs (Ashby,
 * Lever) never return one. Without this the board slug becomes the displayed
 * company, so "k-id" would show up as "K Id" instead of the real name.
 */
export async function discoverBoards(seen: { url: string; company?: string }[]): Promise<number> {
  const found = new Map<string, { kind: string; token: string; label: string; fallback: string }>();

  for (const { url, company } of seen) {
    const board = boardFromUrl(url);
    if (!board) continue;
    const key = `${board.kind}:${board.token.toLowerCase()}`;
    const fallback = fallbackLabel(board);
    const name = company?.trim();
    // A real company name always beats a slug-derived label.
    if (name) found.set(key, { ...board, label: name, fallback });
    else if (!found.has(key)) found.set(key, { ...board, fallback });
  }
  if (found.size === 0) return 0;

  const boards = [...found.values()];
  const now = nowSec();
  const columns = (key: 'kind' | 'token' | 'label' | 'fallback') => boards.map((b) => b[key]);

  const added = await exec(
    `INSERT INTO source_configs (kind, token, label, enabled, created_at)
     SELECT kind, token, label, 1, ?
     FROM unnest(?::text[], ?::text[], ?::text[]) AS s(kind, token, label)
     ON CONFLICT (kind, token) DO NOTHING`,
    [now, columns('kind'), columns('token'), columns('label')],
  );

  // Backfill a real employer name onto boards we only ever saw as a slug.
  // This matters most for Workday and Oracle, whose tokens are hosting details
  // ("ibqbjb.fa.ocs.oraclecloud.com/CX_1") rather than anything a human would
  // recognize, and whose label becomes the company on every listing they own.
  await exec(
    `UPDATE source_configs sc SET label = s.label
     FROM unnest(?::text[], ?::text[], ?::text[], ?::text[]) AS s(kind, token, label, fallback)
     WHERE sc.kind = s.kind AND sc.token = s.token
       AND sc.label <> s.label AND sc.label = s.fallback`,
    [columns('kind'), columns('token'), columns('label'), columns('fallback')],
  );

  return added;
}

/**
 * Verify that application links still resolve, closing the ones that 404 or
 * show a "no longer accepting applications" banner.
 *
 * This is the strongest openness check available, but it costs one request per
 * listing, so it runs over the least-recently-checked rows in bounded batches.
 */
export async function verifyLinks(
  limit = 100,
  opts: { concurrency?: number; onProgress?: (msg: string) => void } = {},
): Promise<{ checked: number; closed: number; alive: number; errors: number }> {
  const now = nowSec();

  const candidates = await q<{ id: string; apply_url: string }>(
    `SELECT id, apply_url FROM internships
     WHERE is_open = 1 AND duplicate_of IS NULL
     ORDER BY COALESCE(link_checked_at, 0) ASC, last_seen_at DESC
     LIMIT ?`,
    [limit],
  );
  // Never request sites whose terms forbid automated access (imported
  // LinkedIn/Handshake/Indeed links). They answer bots with 999/403 anyway,
  // which says nothing about the posting.
  const rows = candidates.filter((row) => {
    try {
      return !NO_FETCH_HOSTS.test(new URL(row.apply_url).hostname);
    } catch {
      return false;
    }
  });

  let closed = 0;
  let alive = 0;
  let errors = 0;

  await mapPool(rows, opts.concurrency ?? 5, async (row) => {
    const result = await checkLink(row.apply_url);
    if (result.status === 0) {
      errors++;
      return; // couldn't reach it; leave the listing alone
    }
    if (result.closed) {
      await exec(
        `UPDATE internships SET is_open = 0, status = 'closed', close_reason = 'dead-link',
            closed_at = ?, link_status = ?, link_checked_at = ? WHERE id = ?`,
        [now, result.status, now, row.id],
      );
      closed++;
    } else {
      await exec('UPDATE internships SET link_status = ?, link_checked_at = ? WHERE id = ?', [
        result.status,
        now,
        row.id,
      ]);
      alive++;
    }
  });

  opts.onProgress?.(`Checked ${rows.length} links: ${alive} alive, ${closed} closed, ${errors} unreachable`);
  return { checked: rows.length, closed, alive, errors };
}

/** How long to wait before retrying a posting whose page yielded nothing. */
const ENRICH_RETRY_DAYS = 7;

/**
 * Fetch the full posting behind links that arrived without a description
 * (the community lists, Hacker News, imports), newest first, and re-classify
 * them with it. That is what gives a GitHub-list posting its requirements,
 * keywords, pay, deadline and eligibility. Each link is tried at most once
 * a week; ATS links go through the ATS's own API, everything else through
 * the page's schema.org JobPosting data, and only where robots.txt allows.
 */
export async function enrichPending(
  limit: number,
  opts: { concurrency?: number } = {},
): Promise<{ tried: number; enriched: number; via: Record<string, number> }> {
  const now = nowSec();
  const rows = await q<EnrichableRow>(
    `SELECT id, source, source_kind, source_id, company, company_url, title, apply_url, locations_json, terms_json,
            is_remote, date_posted, deadline, salary_min, salary_max, salary_period, salary_currency, tags_json
     FROM internships
     WHERE is_open = 1 AND duplicate_of IS NULL
       AND (description IS NULL OR length(description) < 200)
       AND (enriched_at IS NULL OR enriched_at < ?)
     ORDER BY first_seen_at DESC
     LIMIT ?`,
    [now - ENRICH_RETRY_DAYS * DAY, limit],
  );

  const updated: NormalizedListing[] = [];
  const via: Record<string, number> = {};
  await mapPool(rows, opts.concurrency ?? 8, async (row) => {
    const result = await enrichRow(row);
    if (!result) return;
    via[result.via] = (via[result.via] ?? 0) + 1;
    updated.push(result.listing);
  });

  if (updated.length) await upsertListings(updated);
  if (rows.length) {
    await exec('UPDATE internships SET enriched_at = ? WHERE id = ANY(?)', [now, rows.map((r) => r.id)]);
  }
  return { tried: rows.length, enriched: updated.length, via };
}

export interface EnrichableRow {
  id: string; source: string; source_kind: string; source_id: string; company: string; company_url: string | null;
  title: string; apply_url: string; locations_json: string; terms_json: string; is_remote: number;
  date_posted: number | null; deadline: number | null; salary_min: number | null; salary_max: number | null;
  salary_period: string | null; salary_currency: string | null; tags_json: string;
}

/** Fetch one posting's full text and re-normalize it; null when nothing usable came back. */
export async function enrichRow(row: EnrichableRow): Promise<{ listing: NormalizedListing; via: string } | null> {
  const e = await enrichFromUrl(row.apply_url);
  if (!e?.description || e.description.length < 120) return null;
  const hasPay = row.salary_min != null;
  const listing = normalize({
    source: row.source,
    sourceKind: row.source_kind as RawListing['sourceKind'],
    sourceId: row.source_id,
    company: row.company,
    companyUrl: row.company_url ?? e.companyUrl ?? null,
    title: row.title,
    applyUrl: row.apply_url,
    description: e.description,
    locations: e.locations?.length ? e.locations : jsonArray(row.locations_json),
    remoteFlag: e.remote ?? (row.is_remote ? true : null),
    terms: jsonArray(row.terms_json),
    datePosted: row.date_posted ?? e.datePosted ?? null,
    dateUpdated: e.datePosted ?? row.date_posted ?? null,
    deadline: e.deadline ?? row.deadline,
    salaryMin: hasPay ? row.salary_min : e.salaryMin ?? null,
    salaryMax: hasPay ? row.salary_max : e.salaryMax ?? null,
    salaryPeriod: hasPay ? row.salary_period : e.salaryPeriod ?? null,
    salaryCurrency: hasPay ? row.salary_currency : e.salaryCurrency ?? null,
    activeFlag: true,
    // It was already accepted as an internship; the description shouldn't drop it.
    assumeInternship: true,
    tags: [...jsonArray(row.tags_json), `enriched:${e.via}`],
  });
  return listing && listing.id === row.id ? { listing, via: e.via } : null;
}
