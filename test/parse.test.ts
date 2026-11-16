import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseComp } from '../src/lib/parse/comp';
import { findDate, parseDeadline, parseDuration } from '../src/lib/parse/dates';
import { parseEligibility, parseGpa } from '../src/lib/parse/eligibility';
import { classifyField } from '../src/lib/parse/field';
import { parseLocations } from '../src/lib/parse/location';
import { classifyProgram, detectSeason, parseTermString } from '../src/lib/parse/season';
import { extractSkills } from '../src/lib/parse/skills';
import { normalize } from '../src/lib/parse';
import { parseCsv, stripHtml, toCsv } from '../src/lib/util';

describe('classifyProgram', () => {
  it('accepts obvious internship titles', () => {
    for (const title of [
      'Software Engineer Intern',
      'Summer 2026 Internship - Data Science',
      'Mechanical Engineering Co-op',
      'Marketing Apprentice',
      'Summer Analyst, Investment Banking',
      'Research Fellow (Undergraduate)',
    ]) {
      assert.equal(classifyProgram(title).isInternship, true, title);
    }
  });

  it('does not mistake "internal" or "international" for "intern"', () => {
    assert.equal(classifyProgram('Internal Audit Manager').isInternship, false);
    assert.equal(classifyProgram('International Sales Director').isInternship, false);
    assert.equal(classifyProgram('Internet Infrastructure Engineer').isInternship, false);
  });

  it('rejects senior and full-time roles', () => {
    assert.equal(classifyProgram('Senior Software Engineer').isInternship, false);
    assert.equal(classifyProgram('Staff Data Scientist').isInternship, false);
    assert.equal(classifyProgram('Internship Program Manager').isInternship, false);
  });

  it('tags co-ops distinctly', () => {
    assert.equal(classifyProgram('Software Engineering Co-op').programType, 'co-op');
    assert.equal(classifyProgram('Data Apprentice').programType, 'apprenticeship');
  });

  it('accepts research and lab openings that never say "intern"', () => {
    for (const title of [
      'Research Experience for Undergraduates in Neuroscience',
      'Summer Research Program in Cancer Biology',
      '612 lab opportunity: Immunology of Chronic Infection',
      'Postbaccalaureate Research Fellowship',
      'Undergraduate Research Assistant, Cardiology Lab',
      'CDC Research Participation Program',
    ]) {
      assert.equal(classifyProgram(title).isInternship, true, title);
    }
  });

  it('accepts the clinical programs premed students actually apply to', () => {
    for (const title of [
      'Medical Scribe',
      'Pre-Health Summer Immersion',
      'Student Nurse Extern',
      'Pediatric Audiology Extern',
      'Doctor of Physical Therapy Clinical Practicum',
    ]) {
      assert.equal(classifyProgram(title).isInternship, true, title);
    }
  });

  it('rejects career roles that merely contain research words', () => {
    assert.equal(classifyProgram('Research Program Manager').isInternship, false);
    assert.equal(classifyProgram('Sr Research Program Specialist').isInternship, false);
    assert.equal(classifyProgram('Sr. Residency/Fellowship Administrator').isInternship, false);
  });

  it('rejects postdoctoral and faculty appointments', () => {
    // These carry every research keyword there is, but they need a finished
    // doctorate, so they are not student positions.
    assert.equal(classifyProgram('Research Post Doctoral Fellow - Qian Lab').isInternship, false);
    assert.equal(classifyProgram('Postdoctoral Research Associate').isInternship, false);
    assert.equal(classifyProgram('Assistant Professor of Epidemiology').isInternship, false);
  });
});

describe('season detection', () => {
  it('reads explicit terms first', () => {
    const r = detectSeason('Software Engineer Intern', ['Summer 2027']);
    assert.equal(r.season, 'Summer');
    assert.equal(r.year, 2027);
    assert.equal(r.inferred, false);
  });

  it('reads season and year from the title', () => {
    const r = detectSeason('Fall 2026 Data Science Intern', []);
    assert.equal(r.season, 'Fall');
    assert.equal(r.year, 2026);
  });

  it('handles two-digit year shorthand', () => {
    assert.equal(parseTermString("Summer '27 Intern").year, 2027);
  });

  it('infers next summer for a posting made in the autumn', () => {
    const septPost = Math.floor(new Date(2026, 8, 15).getTime() / 1000);
    const r = detectSeason('Summer Intern - Backend', [], '', septPost);
    assert.equal(r.season, 'Summer');
    assert.equal(r.year, 2027);
    assert.equal(r.inferred, true);
  });

  it('returns Unknown rather than guessing a season', () => {
    assert.equal(detectSeason('Software Engineer Intern', []).season, 'Unknown');
  });
});

describe('classifyField', () => {
  const cases: [string, string][] = [
    ['Machine Learning Engineer Intern', 'AI & Machine Learning'],
    ['Frontend Engineer Intern', 'Software Engineering'],
    ['Data Analyst Intern', 'Data & Analytics'],
    ['Quantitative Trading Intern', 'Quantitative Finance'],
    ['UX Design Intern', 'Design & UX'],
    ['Mechanical Engineering Intern', 'Mechanical & Aerospace'],
    ['Cybersecurity Intern', 'Cybersecurity'],
    ['Product Management Intern', 'Product Management'],
    ['Tax Intern', 'Finance & Accounting'],
    ['Clinical Research Intern', 'Healthcare & Life Sciences'],
    ['Electrical Engineering Intern (PCB)', 'Hardware & Electrical'],
    ['Civil Engineering Intern', 'Civil & Structural'],
    // A domain qualifier must beat the generic "research" bucket.
    ['Research Scientist Intern', 'Research & Academia'],
    ['Biology Research Intern', 'Healthcare & Life Sciences'],
    ['ML Research Intern', 'AI & Machine Learning'],
    ['Quantitative Research Intern', 'Quantitative Finance'],
    // Healthcare splits into families a premed can actually filter on, rather
    // than one bucket holding a nurse extern and a bench chemist together.
    ['Nurse Extern - Cardiac ICU', 'Nursing & Allied Health'],
    ['Physical Therapy Aide Intern', 'Nursing & Allied Health'],
    ['Pharmacy Intern', 'Medicine & Clinical Care'],
    ['Dental Assistant Intern', 'Medicine & Clinical Care'],
    ['Pre-Med Summer Scholar', 'Medicine & Clinical Care'],
    ['Behavioral Health Counseling Intern', 'Medicine & Clinical Care'],
    ['Veterinary Medicine Summer Intern', 'Medicine & Clinical Care'],
    ['Epidemiology Intern, State Health Department', 'Public Health'],
    ['Global Health Policy Intern', 'Public Health'],
    ['Clinical Research Coordinator Intern', 'Healthcare & Life Sciences'],
    ['Wet Lab Research Intern', 'Healthcare & Life Sciences'],
    ['Biomedical Engineering Intern - Medical Devices', 'Healthcare & Life Sciences'],
    ['Hospital Administrative Fellow', 'Healthcare & Life Sciences'],
    // Business analytics is its own field rather than scattered across the
    // functions an analyst happens to sit in.
    ['Business Analyst Intern - Summer 2027', 'Business Analytics'],
    ['Business Systems Analyst Co-op', 'Business Analytics'],
    ['Business Intelligence Analyst Intern', 'Business Analytics'],
    ['Power BI Intern', 'Business Analytics'],
    ['Business Analytics Intern', 'Business Analytics'],
    ['Pricing Analyst Intern', 'Business Analytics'],
    ['Product Analyst Intern', 'Business Analytics'],
    ['Consumer Insights Intern', 'Business Analytics'],
    ['People Analytics Intern', 'Business Analytics'],
    ['Revenue Management Intern', 'Business Analytics'],
    ['Data Intern, Analytics & Decision Science', 'Business Analytics'],
    // The neighbors it must not swallow.
    ['Data Analyst Intern', 'Data & Analytics'],
    ['Financial Analyst Intern', 'Finance & Accounting'],
    ['Financial Reporting Intern', 'Finance & Accounting'],
    ['Analytics Engineer Intern', 'Data & Analytics'],
  ];
  for (const [title, expected] of cases) {
    it(`maps "${title}" to ${expected}`, () => {
      assert.equal(classifyField(title).field, expected);
    });
  }
});

describe('parseComp', () => {
  it('parses an hourly range', () => {
    const c = parseComp('The pay range for this internship is $45.00 - $60.00 per hour.');
    assert.equal(c.period, 'hour');
    assert.equal(c.min, 45);
    assert.equal(c.max, 60);
    assert.equal(c.currency, 'USD');
    assert.equal(c.isPaid, 1);
  });

  it('parses a single monthly figure', () => {
    const c = parseComp('Compensation: $8,000/month for the duration of the program.');
    assert.equal(c.period, 'month');
    assert.equal(c.min, 8000);
  });

  it('parses non-USD currencies', () => {
    const c = parseComp('Salary: £28,000 per annum');
    assert.equal(c.currency, 'GBP');
    assert.equal(c.period, 'year');
    assert.equal(c.min, 28000);
  });

  it('detects unpaid roles', () => {
    const c = parseComp('This is an unpaid internship offered for course credit.');
    assert.equal(c.isPaid, 0);
    assert.equal(c.min, null);
  });

  it('ignores dollar figures that are not compensation', () => {
    const c = parseComp('We raised $50M in Series B funding and serve $2B in payment volume.');
    assert.equal(c.min, null, 'should not treat funding amounts as pay');
  });

  it('prefers the range near a compensation heading', () => {
    const c = parseComp(
      'Our customers process $10B annually. Compensation: $30 - $40 per hour depending on experience.',
    );
    assert.equal(c.period, 'hour');
    assert.equal(c.min, 30);
    assert.equal(c.max, 40);
  });

  it('flags pay it cannot quantify', () => {
    const c = parseComp('This is a paid internship with a competitive salary.');
    assert.equal(c.isPaid, 1);
    assert.equal(c.min, null);
  });

  it('does not read a schedule commitment as a pay range', () => {
    // "per week" is a pay period, but 4–5 here counts days. Read as money this
    // became "$17.38–21.73 / month" and polluted the minimum-pay filter.
    const c = parseComp('Interns must be available 4–5 days per week for at least 6 months.');
    assert.equal(c.min, null);
    assert.equal(c.max, null);
  });

  it('does not read hours-per-week or course credits as pay', () => {
    assert.equal(parseComp('You will work 20 - 40 hours per week.').min, null);
    assert.equal(parseComp('Earn 3 to 6 credits per semester.').min, null);
  });

  it('still accepts a real weekly rate', () => {
    const c = parseComp('Compensation: $1,000 - $1,200 per week.');
    assert.equal(c.period, 'month');
    assert.equal(c.min, 4345);
  });
});

describe('parseGpa', () => {
  it('reads a minimum GPA', () => {
    assert.equal(parseGpa('Minimum GPA of 3.5 required'), 3.5);
    assert.equal(parseGpa('Must have a 3.0 cumulative GPA'), 3.0);
    assert.equal(parseGpa('GPA 3.2 or higher'), 3.2);
  });

  it('normalizes a 5.0 scale onto 4.0', () => {
    assert.equal(parseGpa('GPA of 4.0/5.0'), 3.2);
  });

  it('ignores implausible values', () => {
    assert.equal(parseGpa('Founded in 2019 with 4.9 star reviews'), null);
    assert.equal(parseGpa('GPA 0.5'), null);
  });
});

describe('parseEligibility', () => {
  it('detects a citizenship requirement', () => {
    const e = parseEligibility('U.S. Citizenship is required for this position.');
    assert.equal(e.requiresCitizenship, 1);
    assert.equal(e.sponsorship, 'us-citizenship');
  });

  it('detects a clearance requirement', () => {
    const e = parseEligibility('Must hold an active TS/SCI clearance.');
    assert.equal(e.requiresClearance, 1);
  });

  it('detects that sponsorship is not offered', () => {
    const e = parseEligibility('We do not provide visa sponsorship for this role.');
    assert.equal(e.sponsorship, 'does-not-offer');
    assert.equal(e.offersSponsorship, 0);
  });

  it('detects that sponsorship is offered', () => {
    const e = parseEligibility('Visa sponsorship is available for qualified candidates.');
    assert.equal(e.sponsorship, 'offers');
    assert.equal(e.offersSponsorship, 1);
  });

  it('lets the source hint win', () => {
    const e = parseEligibility('', { sponsorship: 'U.S. Citizenship is Required' });
    assert.equal(e.sponsorship, 'us-citizenship');
  });

  it('reads class years and degrees', () => {
    const e = parseEligibility(
      'Open to rising juniors and seniors pursuing a Bachelor’s degree in Computer Science.',
    );
    assert.deepEqual(e.classYears.sort(), ['Junior', 'Senior']);
    assert.deepEqual(e.degrees, ['Bachelors']);
  });

  it('stays unknown when the posting says nothing', () => {
    const e = parseEligibility('Great team, great mission.');
    assert.equal(e.sponsorship, 'unknown');
    assert.equal(e.gpaMin, null);
    assert.deepEqual(e.degrees, []);
  });
});

describe('parseLocations', () => {
  it('keeps US state codes as states, not countries', () => {
    const r = parseLocations(['Palo Alto, CA']);
    assert.equal(r.primary, 'Palo Alto, CA');
    assert.equal(r.region, 'CA');
    assert.equal(r.country, 'United States');
  });

  it('expands full state names to codes', () => {
    assert.equal(parseLocations(['Austin, Texas']).primary, 'Austin, TX');
  });

  it('reads Canadian locations', () => {
    const r = parseLocations(['Toronto, ON, Canada']);
    assert.equal(r.country, 'Canada');
  });

  it('disambiguates a trailing CA with a province code', () => {
    const r = parseLocations(['Vancouver, BC, CA']);
    assert.equal(r.country, 'Canada');
  });

  it('detects remote roles', () => {
    const r = parseLocations(['Remote'], '', true);
    assert.equal(r.locationType, 'remote');
    assert.equal(r.isRemote, 1);
  });

  it('detects hybrid roles', () => {
    assert.equal(parseLocations(['New York, NY (Hybrid)']).locationType, 'hybrid');
  });

  it('does not call an onsite role remote because the copy mentions remote work', () => {
    const r = parseLocations(['Seattle, WA'], 'We support remote collaboration across teams.');
    assert.equal(r.locationType, 'onsite');
    assert.equal(r.isRemote, 0);
  });

  // Workday is the largest single source of listings and writes locations
  // broadest-first with hyphens, which the country and region filters read.
  it('reads a Workday hyphen hierarchy', () => {
    const r = parseLocations(['United States-Florida-Melbourne']);
    assert.equal(r.city, 'Melbourne');
    assert.equal(r.region, 'FL');
    assert.equal(r.country, 'United States');
  });

  it('reorders a country-first location to city-first', () => {
    const r = parseLocations(['US, CA, Santa Clara']);
    assert.equal(r.primary, 'Santa Clara, CA, United States');
    assert.equal(r.city, 'Santa Clara');
  });

  it('unpacks a slugified Workday office address', () => {
    const r = parseLocations(['CA---San-Jose---3850-N-First-St']);
    assert.equal(r.city, 'San Jose');
    assert.equal(r.region, 'CA');
  });

  it('resolves three-letter country codes', () => {
    assert.equal(parseLocations(['Melbourne, Victoria, AUS']).country, 'Australia');
    assert.equal(parseLocations(['Shanghai, CHN']).country, 'China');
  });

  it('does not split ordinary hyphenated place names', () => {
    assert.equal(parseLocations(['Winston-Salem, NC']).city, 'Winston-Salem');
    assert.equal(parseLocations(['Tokyo-To, Japan']).city, 'Tokyo-To');
  });

  it('does not send Mexico, Missouri to Mexico', () => {
    const r = parseLocations(['Mexico, MO']);
    assert.equal(r.city, 'Mexico');
    assert.equal(r.country, 'United States');
  });

  it('resolves a bare city name to its country', () => {
    // Most boards write only a city. Before the gazetteer these rows had no
    // country at all and could not be found by the country filter.
    assert.equal(parseLocations(['London']).country, 'United Kingdom');
    assert.equal(parseLocations(['Amsterdam']).country, 'Netherlands');
    assert.equal(parseLocations(['Bengaluru']).country, 'India');
    const sf = parseLocations(['San Francisco']);
    assert.equal(sf.region, 'CA');
    assert.equal(sf.country, 'United States');
  });

  it('expands city shorthands', () => {
    const r = parseLocations(['NYC']);
    assert.equal(r.city, 'New York');
    assert.equal(r.region, 'NY');
  });

  it('prefers a region stated in the string over the gazetteer', () => {
    assert.equal(parseLocations(['Paris, IDF, Fr']).region, 'IDF');
  });

  it('drops a work-arrangement prefix from the city', () => {
    const r = parseLocations(['Hybrid - Austin, TX']);
    assert.equal(r.city, 'Austin');
    assert.equal(r.locationType, 'hybrid');
  });
});

describe('dates', () => {
  it('parses several date formats', () => {
    const y = (s: number | null) => (s ? new Date(s * 1000).getUTCFullYear() : null);
    assert.equal(y(findDate('March 15, 2026')), 2026);
    assert.equal(y(findDate('15 March 2026')), 2026);
    assert.equal(y(findDate('2026-03-15')), 2026);
    assert.equal(y(findDate('3/15/2026')), 2026);
  });

  it('rejects impossible dates', () => {
    assert.equal(findDate('February 30, 2026'), null);
  });

  it('finds a deadline only near deadline language', () => {
    const now = new Date(2026, 0, 1).getTime();
    const found = parseDeadline('Applications close on March 15, 2026.', now);
    assert.ok(found, 'expected a deadline');
    assert.equal(new Date(found! * 1000).getMonth(), 2);

    assert.equal(
      parseDeadline('Our company was founded on March 15, 2019.', now),
      null,
      'unrelated dates must not become deadlines',
    );
  });

  it('never returns a deadline in the past', () => {
    const now = new Date(2026, 5, 1).getTime();
    assert.equal(parseDeadline('Apply by January 5, 2026.', now), null);
  });

  it('parses durations', () => {
    assert.equal(parseDuration('This is a 12-week summer internship.'), 12);
    assert.equal(parseDuration('a 10 to 12 weeks program'), 11);
    assert.equal(parseDuration('3 month placement'), 13);
  });
});

describe('extractSkills', () => {
  it('pulls known skills out of a posting', () => {
    const skills = extractSkills(
      'You will write Python and TypeScript, use React and PostgreSQL, and deploy on AWS with Docker.',
    );
    for (const expected of ['Python', 'TypeScript', 'React', 'PostgreSQL', 'AWS', 'Docker']) {
      assert.ok(skills.includes(expected), `expected ${expected} in ${skills.join(', ')}`);
    }
  });

  it('does not confuse Java with JavaScript', () => {
    const skills = extractSkills('Experience with JavaScript required.');
    assert.ok(skills.includes('JavaScript'));
    assert.ok(!skills.includes('Java'), 'Java should not match inside JavaScript');
  });
});

describe('stripHtml', () => {
  it('strips tags and decodes entities', () => {
    assert.equal(stripHtml('<p>Hello&nbsp;&amp; welcome</p>'), 'Hello & welcome');
  });

  it('unescapes doubly-encoded markup before stripping', () => {
    assert.equal(stripHtml('&lt;p&gt;Apply now&lt;/p&gt;'), 'Apply now');
  });

  it('rewrites em dashes so none reach the page', () => {
    assert.equal(stripHtml('<p>Paid role&mdash;housing included</p>'), 'Paid role - housing included');
    assert.equal(stripHtml('<p>Ten weeks — full time</p>'), 'Ten weeks - full time');
    assert.equal(stripHtml('<p>Ten weeks &#8212; full time</p>'), 'Ten weeks - full time');
  });
});

describe('normalize', () => {
  const base = {
    source: 'greenhouse:example',
    sourceKind: 'ats' as const,
    sourceId: '123',
    company: 'Example Corp',
    title: 'Software Engineer Intern, Summer 2026',
    applyUrl: 'https://example.com/apply',
  };

  it('produces a fully classified listing', () => {
    const l = normalize({
      ...base,
      description:
        '<p>Join us for a 12-week internship. Minimum GPA of 3.2. Open to rising seniors pursuing a Bachelor’s in CS. ' +
        'You will use Python and React. Compensation: $50 - $65 per hour. We do not provide visa sponsorship. ' +
        'Applications close on December 1, 2026.</p>',
      locations: ['San Francisco, CA'],
      datePosted: Math.floor(Date.now() / 1000),
    });

    assert.ok(l, 'expected a listing');
    assert.equal(l!.season, 'Summer');
    assert.equal(l!.year, 2026);
    assert.equal(l!.field, 'Software Engineering');
    assert.equal(l!.salary_min, 50);
    assert.equal(l!.salary_period, 'hour');
    assert.equal(l!.gpa_min, 3.2);
    assert.equal(l!.sponsorship, 'does-not-offer');
    assert.equal(l!.duration_weeks, 12);
    assert.equal(l!.region, 'CA');
    assert.ok(l!.skills.includes('Python'));
    assert.ok(l!.quality > 0.5, 'a rich posting should score well on quality');
  });

  it('rejects non-internships', () => {
    assert.equal(normalize({ ...base, title: 'Senior Staff Engineer' }), null);
  });

  it('gives the same listing a stable id across runs', () => {
    const a = normalize(base);
    const b = normalize(base);
    assert.equal(a!.id, b!.id);
  });

  it('requires a company, title, and apply URL', () => {
    assert.equal(normalize({ ...base, company: '' }), null);
    assert.equal(normalize({ ...base, applyUrl: '' }), null);
  });
});

describe('csv round-trip', () => {
  it('survives commas, quotes, and newlines', () => {
    const rows = [{ company: 'Acme, Inc.', role: 'He said "hi"', notes: 'line1\nline2' }];
    const parsed = parseCsv(toCsv(rows));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].company, 'Acme, Inc.');
    assert.equal(parsed[0].role, 'He said "hi"');
  });

  it('neutralizes spreadsheet formula injection', () => {
    const csv = toCsv([{ note: '=cmd|calc' }]);
    assert.ok(csv.includes("'=cmd|calc"), 'leading = should be escaped');
  });
});

describe('classifyField: business analytics against description noise', () => {
  it('keeps an analytics title in analytics even when the body is all marketing', () => {
    const body =
      'Join our marketing team. You will support digital marketing campaigns, social media, ' +
      'SEO, brand strategy and content marketing, and help with demand generation.';
    const r = classifyField('Marketing Analytics Intern', body);
    assert.equal(r.field, 'Business Analytics');
    assert.equal(r.roleFamily, 'business-analytics');
  });

  it('keeps a data analyst title out of BI when the body mentions dashboards', () => {
    const body = 'Build dashboards in Power BI and Tableau, track KPIs, and support data visualization.';
    assert.equal(classifyField('Data Analyst Intern', body).roleFamily, 'data-analyst');
  });

  it('never files a role under business analytics on description prose alone', () => {
    const body =
      'Support packaging development. Build dashboards, track KPIs, use Power BI and forecasting ' +
      'to deliver consumer insights and data-driven recommendations.';
    assert.notEqual(classifyField('Internship - R&D Packaging Engineer', body).field, 'Business Analytics');
  });

  it('leaves healthcare analytics to the healthcare taxonomy', () => {
    assert.notEqual(classifyField('Healthcare Analytics Intern').field, 'Business Analytics');
  });

  it('splits the three business analytics families', () => {
    assert.equal(classifyField('Business Analyst Intern').roleFamily, 'business-analyst');
    assert.equal(classifyField('BI Developer Intern').roleFamily, 'business-intelligence');
    assert.equal(classifyField('Sales Analytics Intern').roleFamily, 'business-analytics');
  });
});

describe('tech role coverage', () => {
  const cases: [title: string, family: string][] = [
    ['Quantitative Developer Intern', 'quant-dev'],
    ['Quant Trader Intern', 'quant-trading'],
    ['Quantitative Researcher Intern', 'quant-research'],
    ['UX Research Intern', 'ux-research'],
    ['Product Design Intern', 'product-design'],
    ['Site Reliability Engineering Intern', 'devops'],
    ['Firmware Engineering Intern', 'embedded'],
    ['Data Engineering Intern', 'data-engineering'],
    ['Machine Learning Engineer Intern', 'machine-learning'],
    ['Security Engineering Intern', 'security'],
    ['IT Support Intern', 'it-support'],
    ['Associate Product Manager Intern', 'product-management'],
    ['Hardware Engineer Intern', 'electrical'],
  ];
  for (const [title, family] of cases) {
    it(`${title} -> ${family}`, () => assert.equal(classifyField(title).roleFamily, family));
  }
});

// ------------------------------------------------- requirements & ATS keywords

import { extractKeywords, matchKeywords, packKeywords, resumeKeywords, unpackKeywords } from '../src/lib/parse/keywords';
import { parseGradWindow, parseMajors, splitRequirements, underclassEligibility } from '../src/lib/parse/requirements';
import { computeEligibility, computeMatch } from '../src/lib/fit';
import type { ProfileView } from '../src/lib/types';

const POSTING = `About the role
You'll build data pipelines for our trading platform.

Minimum Qualifications:
• Currently pursuing a BS in Computer Science, Statistics, or a related field
• Expected graduation between December 2027 and June 2028
• Proficiency in Python and SQL
• Experience with distributed systems or data pipelines

Preferred Qualifications:
• Experience with Spark or Airflow
• Familiarity with A/B testing and statistical modeling
• Python experience in production

Benefits
• Free lunch`;

describe('splitRequirements', () => {
  it('splits must-haves from nice-to-haves by section heading', () => {
    const split = splitRequirements(POSTING);
    assert.equal(split.method, 'sections');
    assert.equal(split.must.length, 4);
    assert.match(split.must[2], /Python and SQL/);
    assert.equal(split.nice.length, 3);
    assert.match(split.nice[0], /Spark or Airflow/);
    // Nothing from Benefits or About leaks in.
    assert.ok(![...split.must, ...split.nice].some((s) => /lunch|trading platform/.test(s)));
  });

  it('reads headings that share a line with their first bullet', () => {
    const split = splitRequirements('What you need: • Java • Data structures Bonus points: • Kotlin experience');
    assert.deepEqual(split.must, ['Java', 'Data structures']);
    assert.ok(split.nice.some((s) => /Kotlin/.test(s)));
  });

  it('moves a "preferred" bullet out of the must-have list', () => {
    const split = splitRequirements('Requirements:\n• Python required\n• Experience with React is preferred');
    assert.deepEqual(split.must, ['Python required']);
    assert.deepEqual(split.nice, ['Experience with React is preferred']);
  });

  it('falls back to sentence cues when there are no headings', () => {
    const split = splitRequirements('You must have experience with Java. Knowledge of Kubernetes is a plus. We love dogs.');
    assert.equal(split.method, 'sentences');
    assert.deepEqual(split.must, ['You must have experience with Java.']);
    assert.deepEqual(split.nice, ['Knowledge of Kubernetes is a plus.']);
  });
});

describe('parseGradWindow', () => {
  it('reads a graduation range', () => {
    assert.deepEqual(parseGradWindow(POSTING), { min: 2027, max: 2028 });
  });
  it('reads a single expected graduation year', () => {
    assert.deepEqual(parseGradWindow('Must have an expected graduation date of May 2028.'), { min: 2028, max: 2028 });
    assert.deepEqual(parseGradWindow('Open to the class of 2029.'), { min: 2029, max: 2029 });
  });
  it('ignores years that are not about graduation', () => {
    assert.deepEqual(parseGradWindow('Founded in 2012, we raised a Series B in 2024.'), { min: null, max: null });
  });
});

describe('parseMajors', () => {
  it('finds majors named in degree language only', () => {
    assert.deepEqual(parseMajors(POSTING), ['Computer Science', 'Statistics', 'STEM / related field']);
    assert.deepEqual(parseMajors('Our statistics team ships dashboards.'), []);
  });
});

describe('underclassEligibility', () => {
  const base = { text: '', title: 'Software Engineering Intern', classYears: [], degrees: [], gradMin: null, gradMax: null, termYear: 2027 };
  it('invites freshmen and sophomores when the posting names them', () => {
    assert.equal(underclassEligibility({ ...base, text: 'Open to first- and second-year students.' }), 1);
    assert.equal(underclassEligibility({ ...base, classYears: ['Sophomore'] }), 1);
  });
  it('rules them out by graduation window', () => {
    // Summer 2027 intern graduating by 2028 is a rising senior.
    assert.equal(underclassEligibility({ ...base, gradMin: 2027, gradMax: 2028 }), 0);
    assert.equal(underclassEligibility({ ...base, gradMin: 2029, gradMax: 2030 }), 1);
  });
  it('rules them out for graduate-only and upperclass-only programs', () => {
    assert.equal(underclassEligibility({ ...base, degrees: ['PhD'] }), 0);
    assert.equal(underclassEligibility({ ...base, text: 'Must be a rising senior.' }), 0);
  });
  it('stays unknown when the posting is silent', () => {
    assert.equal(underclassEligibility(base), null);
  });
});

describe('extractKeywords', () => {
  const keywords = extractKeywords(POSTING, { title: 'Data Engineering Intern', ...splitRequirements(POSTING) });
  const terms = keywords.map((k) => k.term);
  it('finds tools, languages and concept phrases', () => {
    for (const t of ['Python', 'SQL', 'Spark', 'Airflow', 'Distributed systems', 'Data pipelines', 'A/B testing', 'Statistical modeling']) {
      assert.ok(terms.includes(t), t);
    }
  });
  it('counts repetition and ranks must-haves above nice-to-haves', () => {
    const python = keywords.find((k) => k.term === 'Python')!;
    assert.equal(python.count, 2);
    assert.ok(terms.indexOf('Python') < terms.indexOf('Airflow'));
  });
  it('round-trips through the compact storage form', () => {
    const back = unpackKeywords(JSON.stringify(packKeywords(keywords)));
    assert.deepEqual(back.map((k) => k.term), terms);
  });
});

describe('resume match', () => {
  const keywords = extractKeywords(POSTING, { ...splitRequirements(POSTING) });
  it('splits have / missing against a resume', () => {
    const mine = resumeKeywords('Skills: Python, SQL, Pandas. Built data pipelines in Airflow.');
    const result = matchKeywords(keywords, mine);
    assert.ok(result.have.some((k) => k.term === 'Python'));
    assert.ok(result.missing.some((k) => k.term === 'Spark'));
    assert.ok(result.score! > 0 && result.score! < 100);
  });
});

function profile(patch: Partial<ProfileView>): ProfileView {
  return {
    user_id: 'u', name: null, email: null, school: null, major: null, minor: null, degree_level: null,
    class_year: null, grad_month: null, grad_year: null, gpa: null, work_auth: null, has_clearance: 0,
    skills_json: '[]', preferred_seasons_json: '[]', preferred_years_json: '[]', preferred_fields_json: '[]',
    preferred_locations_json: '[]', remote_pref: 'any', willing_to_relocate: 1, min_hourly: null, paid_only: 0,
    earliest_start: null, latest_start: null, resume_text: null, weekly_goal: 5, onboarded: 1, calendar_token: 't',
    created_at: 0, updated_at: 0, skills: [], preferred_seasons: [], preferred_years: [], preferred_fields: [],
    preferred_locations: [],
    ...patch,
  } as ProfileView;
}

describe('eligibility badge', () => {
  const freshman = profile({ class_year: 'Freshman', grad_year: 2030, major: 'Statistics and Data Science' });
  const listing = { class_years: [], degrees: ['Bachelors'], grad_year_min: 2027, grad_year_max: 2028, underclass_ok: 0, majors: ['Computer Science', 'Statistics'], year: 2027 };

  it('flags a graduation window the student is outside of', () => {
    const badge = computeEligibility(listing, freshman);
    assert.equal(badge.status, 'ineligible');
    assert.ok(badge.flags.includes('Requires 2027–2028 grads — you graduate in 2030'));
  });

  it('marks roles that invite underclassmen', () => {
    const badge = computeEligibility({ ...listing, grad_year_min: null, grad_year_max: null, underclass_ok: 1 }, freshman);
    assert.equal(badge.status, 'eligible');
    assert.equal(badge.label, 'Open to fr/soph');
  });

  it('matches a major by substring', () => {
    const badge = computeEligibility({ ...listing, grad_year_min: null, grad_year_max: null, underclass_ok: null }, freshman);
    assert.equal(badge.status, 'unclear');
    assert.deepEqual(badge.flags, []);
  });

  it('scores resume match from listed skills and resume text', () => {
    const keywords = extractKeywords(POSTING);
    const match = computeMatch(keywords, profile({ skills: ['Python'], resume_text: 'SQL and Spark projects' }));
    assert.ok(match);
    assert.ok(match!.have.includes('Python') && match!.have.includes('SQL') && match!.have.includes('Spark'));
    assert.ok(match!.missing.includes('Airflow'));
  });
});

describe('normalize fills the requirements columns', () => {
  it('stores keywords, grad window, majors and underclass eligibility', () => {
    const listing = normalize({
      source: 'test', sourceKind: 'ats', sourceId: '1', company: 'Acme', title: 'Data Engineering Intern',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/1', description: POSTING, terms: ['Summer 2027'],
    })!;
    assert.ok(listing.keywords.length > 5);
    assert.equal(listing.grad_year_min, 2027);
    assert.equal(listing.underclass_ok, 0);
    assert.ok(listing.majors.includes('Statistics'));
  });
});

// ------------------------------------------------- resume import & recommendations

import { classYearFor, parseResume } from '../src/lib/parse/resume';
import { computeRecommendation } from '../src/lib/fit';

describe('parseResume', () => {
  const text = `Jordan Rivera
jordan.rivera@example.edu | (555) 010-2233 | linkedin.com/in/jordan-rivera | github.com/jrivera

EDUCATION
Northfield State University, Austin, TX
B.S. in Statistics and Data Science, Minor in Computer Science      Expected May 2030
GPA: 3.85/4.0

EXPERIENCE
Undergraduate Research Assistant, Data Science Lab          Sep 2026 – Present
- Built Python data pipelines with Pandas and SQL; trained scikit-learn models

SKILLS
Python, R, SQL, Git`;
  const r = parseResume(text, new Date('2026-11-16'));

  it('reads contact details and links', () => {
    assert.equal(r.name, 'Jordan Rivera');
    assert.equal(r.email, 'jordan.rivera@example.edu');
    assert.equal(r.phone, '(555) 010-2233');
    assert.equal(r.linkedin_url, 'https://linkedin.com/in/jordan-rivera');
    assert.equal(r.github_url, 'https://github.com/jrivera');
  });
  it('reads education and derives class year from the graduation date', () => {
    assert.equal(r.school, 'Northfield State University');
    assert.equal(r.degree_level, 'Bachelors');
    assert.equal(r.major, 'Statistics and Data Science');
    assert.equal(r.minor, 'Computer Science');
    assert.equal(r.grad_year, 2030);
    assert.equal(r.class_year, 'Freshman');
    assert.equal(r.gpa, 3.85);
  });
  it('finds skills and infers role interests from experience and major', () => {
    for (const s of ['Python', 'SQL', 'Pandas', 'scikit-learn', 'R']) assert.ok(r.skills.includes(s), s);
    assert.equal(r.roleFamilies[0], 'data-science');
  });
  it('maps graduation dates onto class years across the academic year', () => {
    const nov = new Date('2026-11-16');
    assert.equal(classYearFor(2027, 5, nov), 'Senior');
    assert.equal(classYearFor(2028, 5, nov), 'Junior');
    assert.equal(classYearFor(2029, 5, nov), 'Sophomore');
    assert.equal(classYearFor(2027, 12, nov), 'Junior'); // a December grad has one more academic year
  });
});

describe('recommendation score', () => {
  const p = profile({ resume_text: 'Python SQL', preferred_roles: ['data-science', 'machine-learning'] } as never);
  const listing = { role_family: 'data-science', field: 'Data & Analytics', first_seen_at: Date.now() / 1000, date_posted: null };
  const ok = { status: 'eligible' as const, label: '', flags: [] };
  it('ranks role affinity, match and eligibility together', () => {
    const fit = computeRecommendation(listing, { score: 80, have: [], missing: [] }, ok, p)!;
    const offRole = computeRecommendation({ ...listing, role_family: 'sales', field: 'Sales & Business Development' }, { score: 80, have: [], missing: [] }, ok, p)!;
    const ineligible = computeRecommendation(listing, { score: 100, have: [], missing: [] }, { status: 'ineligible', label: '', flags: ['x'] }, p)!;
    assert.ok(fit > offRole);
    assert.ok(ineligible <= 30 && ineligible < offRole);
  });
  it('is null without a resume or skills', () => {
    assert.equal(computeRecommendation(listing, null, ok, profile({})), null);
  });
});
