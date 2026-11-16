import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boardFromUrl, fallbackLabel } from '../src/lib/sources/seed';
import { decodeWorkdayToken } from '../src/lib/sources/workday';

/**
 * Board discovery is what grows the catalog past its seed list: every apply URL
 * the pipeline sees is inspected for an ATS it knows how to crawl. A parser
 * that quietly stops recognizing a provider costs thousands of listings without
 * failing anything, so each shape is pinned here.
 */
describe('boardFromUrl', () => {
  const cases: [url: string, kind: string, token: string][] = [
    [
      'https://boards.greenhouse.io/figma/jobs/12345',
      'greenhouse',
      'figma',
    ],
    [
      'https://jobs.lever.co/palantir/abc-def',
      'lever',
      'palantir',
    ],
    [
      'https://jobs.ashbyhq.com/openai/1234/application',
      'ashby',
      'openai',
    ],
    [
      'https://apply.workable.com/huggingface/j/ABC123/',
      'workable',
      'huggingface',
    ],
    // Workday, the single biggest provider, in both of its hosting shapes.
    [
      'https://ngc.wd1.myworkdayjobs.com/Northrop_Grumman_External_Site/job/Melbourne/Intern_R102',
      'workday',
      'ngc.wd1.myworkdayjobs.com/ngc/Northrop_Grumman_External_Site',
    ],
    [
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Intern_JR1',
      'workday',
      'nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite',
    ],
    [
      'https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/LA/Intern_R004',
      'workday',
      'wd1.myworkdaysite.com/snapchat/snap',
    ],
    [
      'https://ibqbjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Honeywell/job/130547',
      'oracle',
      'ibqbjb.fa.ocs.oraclecloud.com/Honeywell',
    ],
    [
      'https://qualcomm.eightfold.ai/careers/job/446715696771',
      'eightfold',
      'qualcomm.eightfold.ai/qualcomm.com',
    ],
    [
      'https://ats.rippling.com/acretrader-jobs/jobs/763c6149-4335',
      'rippling',
      'acretrader-jobs',
    ],
    [
      'https://berkshiregrey.bamboohr.com/careers/655/',
      'bamboohr',
      'berkshiregrey',
    ],
    [
      'https://onyx-insight.breezy.hr/p/abc-intern',
      'breezy',
      'onyx-insight',
    ],
    // Phenom, which is how most health systems front their ATS.
    [
      'https://careers.chop.edu/us/en/job/1234567/Nurse-Extern',
      'phenom',
      'careers.chop.edu',
    ],
    [
      'https://jobs.sutterhealth.org/job/R-89012',
      'phenom',
      'jobs.sutterhealth.org',
    ],
  ];

  for (const [url, kind, token] of cases) {
    it(`recognizes ${kind} in ${new URL(url).hostname}`, () => {
      const board = boardFromUrl(url);
      assert.ok(board, `expected a board for ${url}`);
      assert.equal(board.kind, kind);
      assert.equal(board.token, token);
    });
  }

  it('ignores links that are not job boards', () => {
    assert.equal(boardFromUrl('https://example.com/careers'), null);
    assert.equal(boardFromUrl('not a url'), null);
    assert.equal(boardFromUrl(''), null);
  });

  it('does not claim every careers host as a Phenom site', () => {
    // A careers hostname alone proves nothing. Only Phenom's own job path does.
    assert.equal(boardFromUrl('https://careers.example.org/search-results'), null);
    assert.equal(boardFromUrl('https://jobs.example.org/openings/1234'), null);
  });

  it('does not mistake the Workday API path for a careers site', () => {
    const board = boardFromUrl('https://ngc.wd1.myworkdayjobs.com/wday/cxs/ngc/Site/jobs');
    assert.equal(board, null);
  });

  it('round-trips a Workday token back to host, tenant, and site', () => {
    const board = boardFromUrl(
      'https://asml.wd3.myworkdayjobs.com/asmlext1/job/San-Diego/Internship_J-1',
    );
    const decoded = decodeWorkdayToken(board!.token);
    assert.deepEqual(decoded, {
      host: 'asml.wd3.myworkdayjobs.com',
      tenant: 'asml',
      site: 'asmlext1',
    });
  });
});

describe('fallbackLabel', () => {
  it('reports the slug-derived name a board gets with no employer name known', () => {
    const board = boardFromUrl(
      'https://ibqbjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
    )!;
    // Discovery replaces this the moment a feed supplies a real company name;
    // the comparison only works if the fallback matches what was stored.
    assert.equal(board.label, fallbackLabel(board));
  });
});

describe('partial fetch marker', () => {
  it('survives on the array it marks and is absent otherwise', async () => {
    const { markPartial, isPartial } = await import('../src/lib/sources/partial');
    const list = markPartial([1, 2, 3]);
    assert.equal(isPartial(list), true);
    assert.equal(isPartial([1, 2, 3]), false);
    // A derived array is a new result and must be marked again on purpose.
    assert.equal(isPartial(list.filter(Boolean)), false);
  });
});

describe('Muse employer discovery', () => {
  it('finds the escaped ATS link a posting page embeds, and nothing else', async () => {
    const { boardUrlsFromHtml } = await import('../src/lib/sources/muse-discovery');
    const html =
      '<a href="https://www.celonis.com/careers/privacy-notice/">x</a>' +
      '"applyUrl":"https://job-boards.greenhouse.io/celonis/jobs/7767090003?gh_jid=7767090003\\\\"' +
      '<a href="https://schwab.wd1.myworkdayjobs.com/en-US/SchwabCareers/job/Austin/Intern_R123?a=1&amp;b=2">';
    const urls = boardUrlsFromHtml(html);
    assert.equal(urls.length, 2);
    assert.ok(urls.some((u) => u.startsWith('https://job-boards.greenhouse.io/celonis/')));
    assert.ok(urls.some((u) => u.includes('a=1&b=2')));
  });

  it('matches employer names loosely', async () => {
    const { employerKey } = await import('../src/lib/sources/muse-discovery');
    assert.equal(employerKey('The Charles Schwab Corporation'), employerKey('Charles Schwab'));
    assert.equal(employerKey('Procter & Gamble'), employerKey('Procter and Gamble Co.'));
  });
});

describe('jibeHost', () => {
  it('reduces a careers URL or host to the bare host', async () => {
    const { jibeHost } = await import('../src/lib/sources/jibe');
    assert.equal(jibeHost('https://Careers.Principal.com/jobs/53110?lang=en-us'), 'careers.principal.com');
    assert.equal(jibeHost('jobs.statefarm.com'), 'jobs.statefarm.com');
  });
});

// ---------------------------------------------------------------- coverage

import { canonicalApplyUrl, parseMarkdownJobTable } from '../src/lib/sources/feeds';
import { parseHiringComment } from '../src/lib/sources/hackernews';
import { queueKey } from '../src/lib/sources/http';
import { NO_FETCH_HOSTS } from '../src/lib/no-fetch';
import { parseSavedJobsCsv } from '../src/lib/import-listing';
import { sameRole } from '../src/lib/sync';
import { dedupeCompany } from '../src/lib/parse';

describe('parseMarkdownJobTable', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const md = [
    '| Company | Position | Location | Salary | Posting | Age |',
    '|---|---|---|---|---|---|',
    '| <a href="https://about.meta.com"><strong>Meta</strong></a> | Research Intern | Burlingame, CA | $50/hr | <a href="https://www.metacareers.com/jobs/1?utm_source=speedy"><img alt="Apply"/></a> | 5d |',
    '| ↳ | Software Engineering Intern | Bellevue, WA +3 | $48/hr | <a href="https://www.metacareers.com/jobs/2"><img alt="Apply"/></a> | 3h |',
    '',
    '| Company | Position | Location | Posting | Age |',
    '|---|---|---|---|---|',
    '| <strong>Amazon</strong> | SDE Intern - Finland | Tampere, Finland | <a href="https://www.amazon.jobs/jobs/10603649/apply">Apply</a> | 2w |',
  ].join('\n');
  const rows = parseMarkdownJobTable(md, 'github:speedy', now);

  it('reads every row, using each table header to place its cells', () => {
    assert.equal(rows.length, 3);
    assert.equal(rows[2].company, 'Amazon');
    assert.deepEqual(rows[2].locations, ['Tampere, Finland']);
    assert.equal(rows[2].salaryMin, null);
  });

  it('carries the company down through "↳" continuation rows', () => {
    assert.equal(rows[1].company, 'Meta');
    assert.deepEqual(rows[1].locations, ['Bellevue, WA']);
  });

  it('turns the age column back into a posting date and pay into numbers', () => {
    assert.equal(rows[0].datePosted, Math.floor((now - 5 * 86_400_000) / 1000));
    assert.equal(rows[1].datePosted, Math.floor((now - 3 * 3_600_000) / 1000));
    assert.equal(rows[0].salaryMin, 50);
    assert.equal(rows[0].salaryPeriod, 'hour');
  });

  it('strips tracking parameters from apply links', () => {
    assert.equal(rows[0].applyUrl, 'https://www.metacareers.com/jobs/1');
  });
});

describe('canonicalApplyUrl', () => {
  it('drops utm and referral parameters but keeps the ones a board needs', () => {
    assert.equal(
      canonicalApplyUrl('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1&utm_source=Simplify&ref=Simplify#app'),
      'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
    );
  });
});

describe('parseHiringComment', () => {
  it('reads company, title, location and the ATS link from a pipe header', () => {
    const listing = parseHiringComment({
      id: 42,
      created_at_i: 1_790_000_000,
      text: 'Acme Robotics | Software Engineering Intern (Summer 2027) | Austin, TX | Onsite<p>We build robots. Apply: <a href="https://jobs.lever.co/acme/123">https://jobs.lever.co/acme/123</a>',
    });
    assert.ok(listing);
    assert.equal(listing!.company, 'Acme Robotics');
    assert.match(listing!.title, /Software Engineering Intern/);
    assert.deepEqual(listing!.locations, ['Austin, TX']);
    assert.equal(listing!.applyUrl, 'https://jobs.lever.co/acme/123');
  });

  it('ignores comments that never mention internships', () => {
    assert.equal(parseHiringComment({ id: 1, text: 'Acme | Senior Engineer | Remote' }), null);
  });
});

describe('Recruitee discovery and Workday pacing', () => {
  it('recognizes Recruitee careers sites', () => {
    assert.deepEqual(boardFromUrl('https://bunq.recruitee.com/o/data-intern')?.kind, 'recruitee');
  });

  it('queues every Workday tenant in a data center together', () => {
    assert.equal(queueKey('cvshealth.wd1.myworkdayjobs.com').key, 'wd1.myworkdayjobs.com');
    assert.equal(queueKey('hitachi.wd1.myworkdayjobs.com').key, 'wd1.myworkdayjobs.com');
    assert.equal(queueKey('boards-api.greenhouse.io').key, 'boards-api.greenhouse.io');
  });
});

describe('sites that are never crawled', () => {
  it('covers LinkedIn, Handshake, Indeed and the other login-walled boards', () => {
    for (const host of ['www.linkedin.com', 'app.joinhandshake.com', 'www.indeed.com', 'jobright.ai', 'wellfound.com', 'builtin.com', 'www.builtinaustin.com', 'www.levels.fyi']) {
      assert.ok(NO_FETCH_HOSTS.test(host), host);
    }
    assert.ok(!NO_FETCH_HOSTS.test('boards.greenhouse.io'));
  });

  it('parses a saved-jobs CSV with loosely named columns', () => {
    const rows = parseSavedJobsCsv('Job Title,Company Name,Job URL,Location\n"Data Science Intern",Acme,https://x.test/1,"Austin, TX"\n,,,\n');
    assert.deepEqual(rows, [
      { title: 'Data Science Intern', company: 'Acme', url: 'https://x.test/1', location: 'Austin, TX', text: undefined },
    ]);
  });
});

describe('cross-source dedupe', () => {
  it('treats legal suffixes as the same employer', () => {
    assert.equal(dedupeCompany('Jane Street Capital, LLC'), dedupeCompany('Jane Street Capital'));
    assert.equal(dedupeCompany('Stripe, Inc.'), dedupeCompany('Stripe'));
    assert.notEqual(dedupeCompany('Two Sigma'), dedupeCompany('Two Sigma Securities'));
  });

  const base = { season: 'Summer', year: 2027, city: 'New York', country: 'US', is_remote: 0 };
  it('merges matching or partially known postings', () => {
    assert.ok(sameRole(base, { ...base }));
    assert.ok(sameRole(base, { ...base, season: 'Unknown', year: null, city: null }));
  });
  it('keeps different terms and cities apart', () => {
    assert.ok(!sameRole(base, { ...base, season: 'Fall' }));
    assert.ok(!sameRole(base, { ...base, year: 2026 }));
    assert.ok(!sameRole(base, { ...base, city: 'Chicago' }));
  });
});

// ------------------------------------------------- scraper upgrades

import { parseAge, parseFirmSections } from '../src/lib/sources/feeds';
import { isAllowedBy, parseRobots } from '../src/lib/sources/robots';
import { extractJobPostingLd, fromJsonLd } from '../src/lib/sources/enrich';
import { logoDomains, registrableDomain } from '../src/lib/logo';

describe('more community list formats', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('reads dates, markdown links, visa columns and skips "Apply with" columns', () => {
    const md = [
      '| Company | Role | Location | Posted | Visa | Link | Apply with Jobbie |',
      '|---|---|---|---|---|---|---|',
      '| [Acme](https://acme.com) | Data Intern | Austin, TX | 2026-11-15 | ✅ Sponsor | [Job listing](https://jobs.ashbyhq.com/acme/1) | <a href="https://jobbie.bot/x">Apply</a> |',
      '| **Beta** | SWE Intern | Remote | 12m | | [<img alt="Apply">](https://jobs.lever.co/beta/2) | |',
    ].join('\n');
    const rows = parseMarkdownJobTable(md, 'github:x', now);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].applyUrl, 'https://jobs.ashbyhq.com/acme/1');
    assert.equal(rows[0].companyUrl, 'https://acme.com');
    assert.equal(rows[0].sponsorshipHint, 'Offers Sponsorship');
    assert.equal(rows[0].datePosted, Math.floor(Date.parse('2026-11-15') / 1000));
    assert.equal(rows[1].applyUrl, 'https://jobs.lever.co/beta/2');
    assert.equal(rows[1].datePosted, Math.floor((now - 12 * 60_000) / 1000));
  });

  it('parses ages and dates', () => {
    assert.equal(parseAge('3h', now), Math.floor((now - 3 * 3_600_000) / 1000));
    assert.equal(parseAge('Nov 13, 2026', now), Math.floor(Date.parse('Nov 13, 2026') / 1000));
    assert.equal(parseAge('n/a', now), null);
  });

  it('reads the per-firm quant list, skipping closed links', () => {
    const md = [
      '## Contributing',
      '## Akuna Capital',
      '**Website**: [Akuna](https://akunacapital.com/careers)',
      '**Locations**: Chicago',
      '|Role|Links|',
      '|-------|-------|',
      '|QD|[✅ ](https://boards.greenhouse.io/akunacapital/jobs/1)|',
      '|SWE|[✅ C++](https://boards.greenhouse.io/akunacapital/jobs/2)&nbsp;[❌ Python](https://boards.greenhouse.io/akunacapital/jobs/3)|',
    ].join('\n');
    const rows = parseFirmSections(md, 'github:nwf');
    assert.deepEqual(rows.map((r) => r.title), ['Quantitative Developer Intern', 'Software Engineering Intern (C++)']);
    assert.equal(rows[0].company, 'Akuna Capital');
    assert.deepEqual(rows[0].locations, ['Chicago']);
  });
});

describe('robots.txt', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /search\nAllow: /search/jobs$\nDisallow: /*?page=\n\nUser-agent: OtherBot\nDisallow: /');
  it('applies longest-match rules for the * group', () => {
    assert.equal(isAllowedBy(rules, '/careers/123'), true);
    assert.equal(isAllowedBy(rules, '/search?q=x'), false);
    assert.equal(isAllowedBy(rules, '/search/jobs'), true);
    assert.equal(isAllowedBy(rules, '/list?page=2'), false);
  });
});

describe('schema.org JobPosting enrichment', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},{"@type":"JobPosting","title":"Data Intern","description":"&lt;p&gt;Python and SQL required&lt;/p&gt;","datePosted":"2026-11-10","validThrough":"2026-12-31T23:59:00Z","jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}},"baseSalary":{"currency":"USD","value":{"minValue":30,"maxValue":40,"unitText":"HOUR"}},"hiringOrganization":{"name":"Acme","sameAs":"https://acme.com"}}]}</script></head></html>`;
  it('finds a JobPosting inside @graph and maps its fields', () => {
    const e = fromJsonLd(extractJobPostingLd(html)!);
    assert.match(e.description!, /Python and SQL required/);
    assert.deepEqual(e.locations, ['Austin, TX, US']);
    assert.equal(e.salaryMin, 30);
    assert.equal(e.salaryPeriod, 'hour');
    assert.equal(e.deadline, Math.floor(Date.parse('2026-12-31T23:59:00Z') / 1000));
    assert.equal(e.companyUrl, 'https://acme.com');
  });
});

describe('company logos', () => {
  it('prefers the curated map, then the employer site, never an ATS host', () => {
    assert.equal(logoDomains({ company: 'Jane Street Capital', apply_url: 'https://www.janestreet.com/join/1' })[0], 'janestreet.com');
    assert.equal(logoDomains({ company: 'Datadog', apply_url: 'https://careers.datadoghq.com/detail/1' })[0], 'datadoghq.com');
    const acme = logoDomains({ company: 'Acme Robotics', apply_url: 'https://boards.greenhouse.io/acmerobotics/jobs/1' });
    assert.ok(!acme.some((d) => d.includes('greenhouse')));
    assert.ok(acme.includes('acmerobotics.com'));
  });
  it('reduces hosts to their registrable domain', () => {
    assert.equal(registrableDomain('careers.example.co.uk'), 'example.co.uk');
    assert.equal(registrableDomain('apply.careers.microsoft.com'), 'microsoft.com');
  });
});
