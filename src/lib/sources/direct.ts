import type { RawListing } from '../parse';
import { getJson } from './http';

/**
 * Employers that publish their own jobs feed rather than an ATS board the
 * generic adapters can read.
 */

// ----------------------------------------------------------------- Jane Street

interface JaneStreetJob {
  id?: number;
  position?: string;
  category?: string;
  availability?: string;
  city?: string;
  overview?: string;
  team?: string;
  duration?: string;
  min_salary?: number | string | null;
  max_salary?: number | string | null;
}

const JANE_STREET_CITIES: Record<string, string> = {
  NYC: 'New York, NY',
  LDN: 'London, United Kingdom',
  HKG: 'Hong Kong',
  SGP: 'Singapore',
  AMS: 'Amsterdam, Netherlands',
  CHI: 'Chicago, IL',
};

/**
 * Jane Street's careers site renders from one public JSON file. Its intern
 * roles are titled by function ("Software Engineer") and marked as internships
 * only in `availability`, so the title gets that word appended; otherwise the
 * internship classifier, which reads titles and descriptions, would drop them.
 */
export async function fetchJaneStreet(): Promise<RawListing[]> {
  const data = await getJson<JaneStreetJob[]>('https://www.janestreet.com/jobs/main.json', {
    timeoutMs: 30_000,
  });
  if (!Array.isArray(data)) return [];

  const money = (v: number | string | null | undefined) => {
    const n = typeof v === 'string' ? Number.parseFloat(v.replace(/[^\d.]/g, '')) : v;
    return n != null && Number.isFinite(n) && n > 0 ? n : null;
  };

  return data
    .filter((job) => job.id && job.position && /intern|co-?op/i.test(job.availability ?? ''))
    .map((job): RawListing => {
      const min = money(job.min_salary);
      const max = money(job.max_salary);
      const title = /\bintern/i.test(job.position ?? '') ? job.position! : `${job.position} Intern`;
      return {
        source: 'janestreet',
        sourceKind: 'ats',
        sourceId: String(job.id),
        company: 'Jane Street',
        companyUrl: 'https://www.janestreet.com',
        title,
        applyUrl: `https://www.janestreet.com/join-jane-street/position/${job.id}/`,
        description: [job.overview, job.duration ? `Duration: ${job.duration}` : null]
          .filter(Boolean)
          .join('\n\n'),
        locations: [JANE_STREET_CITIES[job.city ?? ''] ?? job.city].filter(Boolean) as string[],
        terms: /summer/i.test(job.availability ?? '') ? ['Summer'] : [],
        datePosted: null,
        dateUpdated: null,
        categoryHint: [job.category, job.team].filter(Boolean).join(', '),
        // Jane Street quotes intern pay as an annualized salary.
        salaryMin: min,
        salaryMax: max,
        salaryPeriod: min || max ? (min && min < 500 ? 'hour' : 'year') : null,
        salaryCurrency: 'USD',
        activeFlag: true,
        tags: ['employment:Internship'],
      };
    });
}
