/**
 * Audit every source adapter without touching the database.
 *
 *   npm run audit-sources                       # every feed + 3 seed boards per ATS kind
 *   npm run audit-sources -- --per-kind 10      # sample more boards per kind
 *   npm run audit-sources -- --kinds github,hn  # only these kinds
 *   npm run audit-sources -- --only greenhouse:point72,janestreet:-
 *   npm run audit-sources -- --json out.json    # also write the raw report
 *
 * For each source it reports how long the fetch took, how many postings came
 * back, how many survived normalization as internships, and any error. A
 * source that answers with zero postings is flagged separately from one that
 * fails, because "empty" usually means a dead token or a changed API shape
 * while "failed" usually means a network or rate-limit problem.
 */
import { writeFileSync } from 'node:fs';
import { normalize, type RawListing } from '../src/lib/parse';
import { fetchSourceRaw } from '../src/lib/sources/registry';
import { SEED_BOARDS, SEED_FEEDS } from '../src/lib/sources/seed';
import { mapPool } from '../src/lib/sources/http';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

interface Row {
  kind: string;
  token: string;
  label: string;
  ms: number;
  fetched: number;
  internships: number;
  freshest: string | null;
  verdict: 'ok' | 'empty' | 'no-interns' | 'slow' | 'failed';
  error?: string;
}

const SLOW_MS = 60_000;

async function main() {
  const perKind = Number(arg('per-kind') ?? 3);
  const kinds = arg('kinds')?.split(',').map((k) => k.trim()).filter(Boolean);
  const only = arg('only')?.split(',').map((k) => k.trim()).filter(Boolean);
  const out = arg('json');

  const byKind = new Map<string, typeof SEED_BOARDS>();
  for (const board of SEED_BOARDS) {
    const bucket = byKind.get(board.kind) ?? [];
    if (bucket.length < perKind) bucket.push(board);
    byKind.set(board.kind, bucket);
  }
  let targets = [...SEED_FEEDS, ...[...byKind.values()].flat()];
  if (kinds?.length) targets = targets.filter((t) => kinds.includes(t.kind));
  if (only?.length) {
    const all = [...SEED_FEEDS, ...SEED_BOARDS];
    targets = all.filter((t) => only.includes(`${t.kind}:${t.token}`));
  }

  console.log(`Auditing ${targets.length} sources…\n`);
  const rows: Row[] = [];

  await mapPool(targets, 8, async (target) => {
    const t0 = Date.now();
    try {
      const raw: RawListing[] = await fetchSourceRaw(target.kind, target.token, target.label);
      const normalized = raw.map((r) => normalize(r)).filter(Boolean);
      const newest = Math.max(0, ...raw.map((r) => r.datePosted ?? 0));
      const ms = Date.now() - t0;
      const verdict: Row['verdict'] =
        raw.length === 0 ? 'empty' : normalized.length === 0 ? 'no-interns' : ms > SLOW_MS ? 'slow' : 'ok';
      rows.push({
        kind: target.kind,
        token: target.token,
        label: target.label,
        ms,
        fetched: raw.length,
        internships: normalized.length,
        freshest: newest ? new Date(newest * 1000).toISOString().slice(0, 10) : null,
        verdict,
      });
    } catch (err) {
      rows.push({
        kind: target.kind,
        token: target.token,
        label: target.label,
        ms: Date.now() - t0,
        fetched: 0,
        internships: 0,
        freshest: null,
        verdict: 'failed',
        error: ((err as Error).message ?? String(err)).slice(0, 160),
      });
    }
    const last = rows[rows.length - 1];
    console.log(
      `${last.verdict.padEnd(10)} ${`${last.kind}:${last.token}`.slice(0, 60).padEnd(62)} ` +
        `${String(last.internships).padStart(5)} / ${String(last.fetched).padStart(5)}  ${(last.ms / 1000).toFixed(1)}s` +
        (last.error ? `  ${last.error}` : ''),
    );
  });

  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.token.localeCompare(b.token));
  const count = (v: Row['verdict']) => rows.filter((r) => r.verdict === v).length;
  console.log(
    `\n${rows.length} sources: ${count('ok')} ok, ${count('slow')} slow, ${count('empty')} empty, ` +
      `${count('no-interns')} with no internships, ${count('failed')} failed. ` +
      `${rows.reduce((s, r) => s + r.internships, 0)} internships in total.`,
  );
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
