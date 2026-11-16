import type { RawListing } from '../parse';
import { fetchAshby, fetchGem, fetchGreenhouse, fetchLever, fetchRecruitee, fetchSmartRecruiters } from './ats';
import { fetchAmazon, fetchBamboo, fetchBreezy, fetchPersonio, fetchRippling } from './bigtech';
import { fetchJaneStreet } from './direct';
import { fetchEightfold } from './eightfold';
import { fetchArbeitnow, fetchGithubList, fetchJobicy, fetchMuse, fetchRemoteOk } from './feeds';
import { fetchHackerNews } from './hackernews';
import { fetchJibe } from './jibe';
import { fetchOracle } from './oracle';
import { fetchPhenom } from './phenom';
import { fetchOrise, fetchUsaJobs } from './research';
import { fetchWorkable } from './workable';
import { fetchWorkday } from './workday';

export interface FetchSourceOptions {
  /** A run that must fit a serverless time limit (see SyncOptions.light). */
  light?: boolean;
}

/**
 * One place that knows which adapter serves which source kind. The sync
 * pipeline and `npm run audit-sources` both go through it, so an audit
 * exercises exactly the code a sync runs.
 */
export async function fetchSourceRaw(
  kind: string,
  token: string,
  label: string,
  opts: FetchSourceOptions = {},
): Promise<RawListing[]> {
  switch (kind) {
    case 'greenhouse':
      return fetchGreenhouse(token, label);
    case 'lever':
      return fetchLever(token, label);
    case 'ashby':
      return fetchAshby(token, label);
    case 'smartrecruiters':
      return fetchSmartRecruiters(token, label);
    case 'recruitee':
      return fetchRecruitee(token, label);
    case 'gem':
      return fetchGem(token, label);
    case 'workable':
      return fetchWorkable(token, label);
    case 'workday':
      return fetchWorkday(token, label);
    case 'oracle':
      return fetchOracle(token, label);
    case 'phenom':
      return fetchPhenom(token, label);
    case 'eightfold':
      return fetchEightfold(token, label);
    case 'rippling':
      return fetchRippling(token, label);
    case 'bamboohr':
      return fetchBamboo(token, label);
    case 'breezy':
      return fetchBreezy(token, label);
    case 'jibe':
      return fetchJibe(token, label);
    case 'personio':
      return fetchPersonio(token, label);
    case 'amazon':
      return fetchAmazon();
    case 'janestreet':
      return fetchJaneStreet();
    case 'muse':
      return fetchMuse(opts.light ? { budget: 100 } : {});
    case 'orise':
      return fetchOrise();
    case 'usajobs':
      return fetchUsaJobs();
    case 'jobicy':
      return fetchJobicy();
    case 'github':
      return fetchGithubList(token);
    case 'hn':
      return fetchHackerNews();
    case 'remoteok':
      return fetchRemoteOk();
    case 'arbeitnow':
      return fetchArbeitnow();
    default:
      throw new Error(`Unknown source kind: ${kind}`);
  }
}
