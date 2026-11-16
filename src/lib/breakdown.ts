import { profileTerms } from './fit';
import { extractKeywords, keywordCategory, resumeKeywords, resumeSection, type KeywordCategory } from './parse/keywords';
import { splitRequirements } from './parse/requirements';
import type { InternshipView, ProfileView } from './types';
import { formatPay } from './util';

/**
 * The full requirements & ATS breakdown for one posting, shown in the detail
 * panel. Built on demand from the stored description rather than stored, so
 * it costs no database space and always reflects the current parser.
 */
export interface QualificationItem {
  text: string;
  /** Vocabulary terms in this line that your resume or skills already show. */
  have: string[];
  /** Terms in this line you don't show yet. */
  missing: string[];
}

export interface Breakdown {
  must: string[];
  nice: string[];
  mustItems: QualificationItem[];
  niceItems: QualificationItem[];
  splitMethod: 'sections' | 'sentences' | 'none';
  facts: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }[];
  keywords: {
    term: string;
    count: number;
    category: KeywordCategory;
    section: string;
    have: boolean | null;
  }[];
  /** "How to pass the ATS" advice, most important first. */
  atsTips: string[];
  redFlags: string[];
}

const SPONSORSHIP_TEXT: Record<string, string> = {
  offers: 'Sponsors visas',
  'does-not-offer': 'No visa sponsorship',
  'us-citizenship': 'U.S. citizens only',
  clearance: 'Security clearance required',
  unknown: 'Not stated',
};

export function buildBreakdown(view: InternshipView, profile: ProfileView | null): Breakdown {
  const description = view.description ?? '';
  const split = splitRequirements(description);
  // Full extraction here (not the stored top-20), weighted by the split.
  const keywords = description
    ? extractKeywords(description, { title: view.title, must: split.must, nice: split.nice, limit: 24 })
    : view.keywords.map((k, i) => ({ ...k, weight: 24 - i, category: keywordCategory(k.term) }));
  const mine = profile ? new Set(profileTerms(profile).map((t) => t.toLowerCase())) : null;

  const pay = formatPay(view.salary_min, view.salary_max, view.salary_period, view.salary_currency ?? 'USD');
  const term = view.season !== 'Unknown' ? `${view.season}${view.year ? ` ${view.year}` : ''}` : view.year ? String(view.year) : 'Not stated';
  const grad =
    view.grad_year_min != null
      ? view.grad_year_min === view.grad_year_max
        ? `Graduating ${view.grad_year_min}`
        : `Graduating ${view.grad_year_min}–${view.grad_year_max}`
      : null;

  const facts: Breakdown['facts'] = [
    { label: 'Class year', value: view.class_years.length ? view.class_years.join(', ') : grad ?? 'Not stated' },
    ...(grad && view.class_years.length ? [{ label: 'Graduation window', value: grad }] : []),
    {
      label: 'Freshmen / sophomores',
      value: view.underclass_ok === 1 ? 'Invited' : view.underclass_ok === 0 ? 'Not eligible' : 'Not stated',
      tone: view.underclass_ok === 1 ? 'good' : view.underclass_ok === 0 ? 'bad' : 'neutral',
    },
    { label: 'Degree', value: view.degrees.length ? view.degrees.join(', ') : 'Not stated' },
    { label: 'Majors', value: view.majors.length ? view.majors.join(', ') : 'Not stated' },
    { label: 'GPA', value: view.gpa_min != null ? `${view.gpa_min.toFixed(2)}+` : 'No cutoff stated' },
    {
      label: 'Work authorization',
      value: SPONSORSHIP_TEXT[view.sponsorship] ?? 'Not stated',
      tone: view.sponsorship === 'offers' ? 'good' : view.sponsorship === 'unknown' ? 'neutral' : 'bad',
    },
    {
      label: 'Location',
      value: [view.primary_location, view.location_type !== 'unknown' ? view.location_type : null].filter(Boolean).join(' · ') || 'Not stated',
    },
    { label: 'Season', value: term },
    ...(view.start_date ? [{ label: 'Starts', value: new Date(view.start_date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }] : []),
    ...(view.duration_weeks ? [{ label: 'Length', value: `${view.duration_weeks} weeks` }] : []),
    { label: 'Pay', value: pay ?? (view.is_paid === 0 ? 'Unpaid' : 'Not stated'), tone: pay ? 'good' : 'neutral' },
  ];

  const enriched = keywords.map((k) => ({
    term: k.term,
    count: k.count,
    category: k.category,
    section: resumeSection(k.category),
    have: mine ? mine.has(k.term.toLowerCase()) : null,
  }));

  const missing = enriched.filter((k) => k.have === false && k.category !== 'soft');
  const atsTips: string[] = [];
  if (mine && missing.length) {
    atsTips.push(
      `Mirror these exact terms where they're true for you: ${missing.slice(0, 6).map((k) => k.term).join(', ')}.`,
    );
  }
  const tech = enriched.filter((k) => ['language', 'framework', 'tool'].includes(k.category)).slice(0, 8);
  if (tech.length) atsTips.push(`Skills section: list ${tech.map((k) => k.term).join(', ')} using the posting's spelling.`);
  const course = enriched.filter((k) => k.category === 'coursework');
  if (course.length) atsTips.push(`Relevant Coursework: name ${course.map((k) => k.term).join(', ')} if you've taken them.`);
  const concepts = enriched.filter((k) => k.category === 'concept' || k.category === 'domain').slice(0, 5);
  if (concepts.length) {
    atsTips.push(`Project/Experience bullets: show ${concepts.map((k) => k.term).join(', ')} with a result ("built…", "cut… by 30%").`);
  }
  const repeated = enriched.filter((k) => k.count >= 3);
  if (repeated.length) atsTips.push(`Repeated ${repeated.map((k) => `"${k.term}" ×${k.count}`).join(', ')}: these weigh most with the screen.`);
  if (view.requires_cover_letter) atsTips.push('Asks for a cover letter: reuse two or three of the keywords above in it.');
  if (view.requires_portfolio) atsTips.push('Asks for a portfolio or GitHub: link it in your resume header.');
  if (view.requires_transcript) atsTips.push('Asks for a transcript: have an unofficial PDF ready.');
  atsTips.push('Use a single-column resume with standard headings (Education, Experience, Projects, Skills) so the ATS parses it.');

  const annotate = (text: string): QualificationItem => {
    const terms = resumeKeywords(text).filter((t) => keywordCategory(t) !== 'soft');
    return {
      text,
      have: mine ? terms.filter((t) => mine.has(t.toLowerCase())) : [],
      missing: mine ? terms.filter((t) => !mine.has(t.toLowerCase())) : terms,
    };
  };

  return {
    must: split.must,
    nice: split.nice,
    mustItems: split.must.map(annotate),
    niceItems: split.nice.map(annotate),
    splitMethod: split.method,
    facts,
    keywords: enriched,
    atsTips,
    redFlags: view.eligibility.flags,
  };
}
