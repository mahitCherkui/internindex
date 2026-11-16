/**
 * Re-run the field classifier over listings already in the catalog.
 *
 *   npm run reclassify                                # tech + business analytics fields
 *   npm run reclassify -- --field "Public Health"     # into any other field(s), comma separated
 *   npm run reclassify -- --dry-run                   # report, change nothing
 *   npm run reclassify -- --force                     # even if this version already ran
 *
 * A sync reclassifies each listing whenever its board is fetched again, which
 * for a capped run can take a day or two to reach every board. This applies a
 * taxonomy change to the whole catalog at once.
 *
 * Only moves *into* the target field are applied. The catalog does not store
 * the category hints some feeds supply, so a blanket re-run would quietly move
 * rows that were classified on information it no longer has; restricting it
 * to the field that just changed keeps everything else exactly as it was.
 *
 * It reads every open listing's description, so it runs once per
 * CLASSIFIER_VERSION and is a no-op after that, which is what lets the
 * scheduled sync call it on every run.
 *
 * Writes to the Postgres database in SUPABASE_DB_URL (or DATABASE_URL).
 */
import { closePool, exec, meta, q, setMeta } from '../src/lib/db';
import { CLASSIFIER_VERSION, classifyField } from '../src/lib/parse/field';
import { parseEligibility } from '../src/lib/parse/eligibility';
import { extractKeywords, packKeywords } from '../src/lib/parse/keywords';
import {
  parseGradWindow,
  parseMajors,
  splitRequirements,
  underclassEligibility,
} from '../src/lib/parse/requirements';

/**
 * Fields a plain `npm run reclassify` moves rows into: every tech field the
 * classifier was extended for, plus Business Analytics.
 */
const DEFAULT_FIELDS = [
  'Business Analytics',
  'Software Engineering',
  'Data & Analytics',
  'AI & Machine Learning',
  'Quantitative Finance',
  'Design & UX',
  'Cybersecurity',
  'IT & Systems',
  'Hardware & Electrical',
  'Product Management',
].join(',');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

const BATCH = 2000;

async function main() {
  const target = arg('field') ?? DEFAULT_FIELDS;
  const targets = new Set(target.split(',').map((f) => f.trim()).filter(Boolean));
  const dryRun = arg('dry-run') === 'true';
  const includeClosed = arg('include-closed') === 'true';
  const stamp = `reclassify:${target}`;

  if (arg('force') !== 'true' && (await meta(stamp)) === CLASSIFIER_VERSION) {
    console.log(`Classifier ${CLASSIFIER_VERSION} already applied to ${target}; nothing to do.`);
    await closePool();
    return;
  }

  let after = '';
  let scanned = 0;
  const moves = new Map<string, number>();
  let changed = 0;

  for (;;) {
    const rows = await q<{
      id: string;
      title: string;
      description: string | null;
      field: string;
      role_family: string;
      class_years_json: string;
      degrees_json: string;
      year: number | null;
    }>(
      `SELECT id, title, description, field, role_family, class_years_json, degrees_json, year FROM internships
       WHERE id > ? ${includeClosed ? '' : 'AND is_open = 1'}
       ORDER BY id LIMIT ?`,
      [after, BATCH],
    );
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    scanned += rows.length;

    // Requirements columns (added in migration 0007) are filled for every row,
    // independent of whether its field moves.
    const extracted = rows.map((row) => {
      const description = row.description ?? '';
      const split = splitRequirements(description);
      const grad = parseGradWindow(description);
      const elig = parseEligibility(description);
      const classYears = safeArray(row.class_years_json);
      const degrees = safeArray(row.degrees_json);
      return {
        id: row.id,
        keywords_json: JSON.stringify(
          packKeywords(extractKeywords(description, { title: row.title, must: split.must, nice: split.nice })),
        ),
        grad_year_min: grad.min,
        grad_year_max: grad.max,
        majors_json: JSON.stringify(parseMajors(description)),
        underclass_ok: underclassEligibility({
          text: description,
          title: row.title,
          classYears: (classYears.length ? classYears : elig.classYears) as never,
          degrees: (degrees.length ? degrees : elig.degrees) as never,
          gradMin: grad.min,
          gradMax: grad.max,
          termYear: row.year,
        }),
      };
    });
    if (!dryRun) {
      await exec(
        `UPDATE internships i SET keywords_json = u.keywords_json, grad_year_min = u.grad_year_min,
            grad_year_max = u.grad_year_max, majors_json = u.majors_json, underclass_ok = u.underclass_ok
         FROM jsonb_to_recordset(?::jsonb) AS u(id text, keywords_json text, grad_year_min smallint,
            grad_year_max smallint, majors_json text, underclass_ok smallint)
         WHERE i.id = u.id`,
        [JSON.stringify(extracted)],
      );
    }

    const updates: { id: string; field: string; role_family: string }[] = [];
    for (const row of rows) {
      const next = classifyField(row.title, row.description ?? '');
      if (!targets.has(next.field)) continue;
      if (next.field === row.field && next.roleFamily === row.role_family) continue;
      updates.push({ id: row.id, field: next.field, role_family: next.roleFamily });
      const key = `${row.role_family} -> ${next.roleFamily}`;
      moves.set(key, (moves.get(key) ?? 0) + 1);
    }

    if (updates.length && !dryRun) {
      await exec(
        `UPDATE internships i SET field = u.field, role_family = u.role_family
         FROM unnest(?::text[], ?::text[], ?::text[]) AS u(id, field, role_family)
         WHERE i.id = u.id`,
        [updates.map((u) => u.id), updates.map((u) => u.field), updates.map((u) => u.role_family)],
      );
    }
    changed += updates.length;
  }

  if (!dryRun) await setMeta(stamp, CLASSIFIER_VERSION);
  console.log(`Scanned ${scanned.toLocaleString()} listings; ${changed.toLocaleString()} ${dryRun ? 'would move' : 'moved'} into ${target}.`);
  for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(6)}  ${move}`);
  }
  await closePool();
}

main().catch((err) => {
  console.error('Reclassify failed:', err);
  process.exit(1);
});

function safeArray(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
