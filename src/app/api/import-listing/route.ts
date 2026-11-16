import { fail, handler, ok, readJson, requireUserId } from '@/lib/api';
import { importListing, parseSavedJobsCsv, type ImportOutcome } from '@/lib/import-listing';
import { markDuplicates } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Rows read from one saved-jobs export, so a huge file can't run past the time limit. */
const MAX_CSV_ROWS = 60;

/**
 * POST /api/import-listing: bring in a posting from a site this app does not
 * crawl (LinkedIn, Handshake, Indeed, Jobright, …).
 *
 *   { url, title?, company?, location?, text? }   one posting
 *   { csv }                                        a saved-jobs export
 *
 * Links to a company ATS are resolved through that ATS's official API and
 * stored as the canonical posting; anything else is parsed from the pasted
 * text. Imported postings are added to the caller's shortlist.
 */
export const POST = handler(async (request: Request) => {
  const auth = await requireUserId();
  if (auth instanceof Response) return auth;
  const body = await readJson(request);
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40_000) : undefined);

  const inputs =
    typeof body.csv === 'string'
      ? parseSavedJobsCsv(body.csv).slice(0, MAX_CSV_ROWS)
      : [
          {
            url: str(body.url),
            title: str(body.title),
            company: str(body.company),
            location: str(body.location),
            text: str(body.text),
          },
        ];
  if (inputs.length === 0) {
    return fail('Nothing to import. A CSV needs at least a title and a company column.');
  }

  const results: ImportOutcome[] = [];
  for (const input of inputs) {
    try {
      results.push(await importListing(auth, input));
    } catch (err) {
      results.push({ id: null, via: 'skipped', message: (err as Error).message });
    }
  }
  // Fold the new rows into any copies the crawl already has.
  if (results.some((r) => r.id)) await markDuplicates();

  return ok({
    imported: results.filter((r) => r.id).length,
    skipped: results.filter((r) => !r.id).length,
    results,
  });
});
