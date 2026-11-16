import type { ClassYear, Degree, Field } from '../types';
import { classifyField } from './field';
import { keywordCategory, resumeKeywords } from './keywords';
import { allSkills } from './skills';

/**
 * Read a resume into profile fields. Deterministic and local: nothing leaves
 * the server. Every field is optional, because resumes vary wildly, and the
 * UI shows what was found for the student to confirm before saving.
 */
export interface ParsedResume {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  school: string | null;
  degree_level: Degree | null;
  major: string | null;
  minor: string | null;
  grad_month: number | null;
  grad_year: number | null;
  class_year: ClassYear | null;
  gpa: number | null;
  /** Skills from the curated vocabulary, so they match what postings ask for. */
  skills: string[];
  /** Every ATS keyword recognized (skills plus concepts and coursework). */
  keywords: string[];
  /** Fields the experience and projects point to, strongest first. */
  interests: Field[];
  /** Role families behind those interests, for ranking. */
  roleFamilies: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function month(token: string): number | null {
  const i = MONTHS.indexOf(token.slice(0, 3).toLowerCase());
  if (i >= 0) return i + 1;
  if (/spring/i.test(token)) return 5;
  if (/summer/i.test(token)) return 8;
  if (/fall|autumn/i.test(token)) return 12;
  if (/winter/i.test(token)) return 12;
  return null;
}

/** Lines between an "Education" heading and the next section heading. */
function section(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => heading.test(l) && l.length < 40);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(?:experience|work experience|professional experience|projects?|skills|technical skills|leadership|activities|awards|honors|publications|research|involvement|certifications)\b/i.test(line) && line.length < 40) break;
    out.push(line);
  }
  return out;
}

/** Map years-until-graduation onto a class year, relative to the academic year now in progress. */
export function classYearFor(gradYear: number, gradMonth: number | null, now = new Date()): ClassYear {
  // An academic year runs Aug–May; from June on we're in the next one.
  const academicEnd = now.getMonth() >= 5 ? now.getFullYear() + 1 : now.getFullYear();
  const effectiveGrad = gradMonth != null && gradMonth >= 8 ? gradYear + 1 : gradYear; // December grads finish that academic year
  const left = effectiveGrad - academicEnd;
  if (left >= 3) return 'Freshman';
  if (left === 2) return 'Sophomore';
  if (left === 1) return 'Junior';
  if (left === 0) return 'Senior';
  return 'Graduate';
}

const DEGREE_RE =
  /\b(B\.?\s?S\.?|B\.?\s?A\.?|B\.?\s?Sc\.?|B\.?\s?E\.?|BBA|Bachelor(?:'s)?(?:\s+of\s+(?:Science|Arts|Engineering|Business Administration))?|M\.?\s?S\.?|M\.?\s?Eng\.?|Master(?:'s)?(?:\s+of\s+(?:Science|Arts|Engineering))?|MBA|Ph\.?\s?D\.?|Associate(?:'s)?)\b\.?\s*(?:degree\s*)?(?:in|of|,|:|–|-)?\s*([A-Z][A-Za-z&/,\s]{2,70}?)(?=\s*(?:,|;|\||\(|\bminor\b|\bGPA\b|\bexpected\b|\b(?:19|20)\d\d\b|\n|$|[–-]\s|·))/;

function degreeLevel(token: string): Degree {
  if (/ph\.?\s?d/i.test(token)) return 'PhD';
  if (/mba/i.test(token)) return 'MBA';
  if (/^m|master/i.test(token)) return 'Masters';
  if (/associate/i.test(token)) return 'Associate';
  return 'Bachelors';
}

export function parseResume(raw: string, now = new Date()): ParsedResume {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // ---- Contact ----
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text)?.[0] ?? null;
  const phone = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(text)?.[0]?.trim() ?? null;
  const url = (re: RegExp) => {
    const m = re.exec(text)?.[0];
    return m ? (m.startsWith('http') ? m : `https://${m}`).replace(/[).,;]+$/, '') : null;
  };
  const linkedin_url = url(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i);
  const github_url = url(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?(?![A-Za-z0-9_/-])/i);
  const portfolio_url = (() => {
    const candidates = text.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:dev|io|me|com|app|site|xyz|net)(?:\/[^\s|,;)]*)?/gi) ?? [];
    const own = candidates.find((c) => !/linkedin|github|gmail|outlook|yahoo|icloud|hotmail|\.edu|google|microsoft|amazon/i.test(c) && !c.includes('@'));
    return own ? (own.startsWith('http') ? own : `https://${own}`) : null;
  })();

  // ---- Name: the first short line that is just capitalized words ----
  const name =
    lines
      .slice(0, 5)
      .find((l) => /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(l) && !/resume|curriculum|vitae|university|college/i.test(l)) ?? null;

  // ---- Education ----
  const education = section(lines, /^education\b/i);
  const eduText = (education.length ? education : lines).join('\n');
  const school =
    /([A-Z][A-Za-z.&'’-]+(?:\s+(?:of|at|the|[A-Z][A-Za-z.&'’-]+))*\s+(?:University|College|Institute of Technology|Institute)(?:\s+(?:of|at)\s+[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)*)?|University\s+of\s+[A-Z][A-Za-z.'’-]+(?:[\s,–-]+(?:at\s+)?[A-Z][A-Za-z.'’-]+)*)/.exec(eduText)?.[1]?.replace(/\s+/g, ' ').replace(/[,–-]\s*$/, '').trim() ?? null;

  const degree = DEGREE_RE.exec(eduText);
  const degree_level = degree ? degreeLevel(degree[1]) : null;
  let major = degree?.[2]?.replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim() ?? null;
  if (!major) major = /\b(?:major|majoring)\s*(?:in|:)?\s*([A-Z][A-Za-z&/\s]{2,50}?)(?=\s*(?:,|;|\||\n|$|minor))/i.exec(eduText)?.[1]?.trim() ?? null;
  const minor = /\bminor\s*(?:in|:)?\s*([A-Z][A-Za-z&/]+(?: [A-Za-z&/]+){0,5}?)(?=\s{2,}|\s*(?:,|;|\||\n|$|GPA|expected|anticipated|(?:19|20)\d\d))/i.exec(eduText)?.[1]?.trim() ?? null;

  // Graduation: an explicit "Expected May 2030", else the latest date in the education section.
  const expected = /(?:expected|anticipated|graduat\w*|class of)[^\n\d]{0,20}?(?:([A-Za-z]{3,9})\.?\s+)?((?:19|20)\d{2})/i.exec(eduText);
  let grad_year: number | null = expected ? Number(expected[2]) : null;
  let grad_month: number | null = expected?.[1] ? month(expected[1]) : null;
  if (!grad_year) {
    const dates = [...eduText.matchAll(/(?:([A-Za-z]{3,9})\.?\s+)?((?:19|20)\d{2})/g)].map((m) => ({ y: Number(m[2]), m: m[1] ? month(m[1]) : null }));
    const latest = dates.filter((d) => d.y >= 1990 && d.y <= now.getFullYear() + 7).sort((a, b) => b.y - a.y)[0];
    if (latest) {
      grad_year = latest.y;
      grad_month = latest.m;
    }
  }
  const class_year = grad_year
    ? degree_level && degree_level !== 'Bachelors' && degree_level !== 'Associate'
      ? 'Graduate'
      : classYearFor(grad_year, grad_month, now)
    : null;

  const gpaMatch = /\bGPA\b[^0-9]{0,12}([0-4]\.\d{1,2})(?:\s*\/\s*([45](?:\.0+)?))?/i.exec(text) ?? /([0-4]\.\d{1,2})\s*\/\s*4\.0+\s*GPA/i.exec(text);
  let gpa = gpaMatch ? Number(gpaMatch[1]) : null;
  if (gpa != null && gpaMatch?.[2] && Number(gpaMatch[2]) === 5) gpa = Math.round((gpa / 5) * 4 * 100) / 100;
  if (gpa != null && (gpa < 1 || gpa > 4)) gpa = null;

  // ---- Skills and interests ----
  const keywords = resumeKeywords(text);
  const vocab = new Set(allSkills());
  const skills = keywords.filter((k) => vocab.has(k));

  // Classify each experience / project line as if it were a job posting and
  // tally the families: whatever the student has actually done most of.
  const tallies = new Map<string, { field: Field; score: number }>();
  for (const line of lines) {
    if (line.length < 25) continue;
    const cls = classifyField(line, '', '');
    if (cls.roleFamily === 'other' || cls.confidence < 0.2) continue;
    const entry = tallies.get(cls.roleFamily) ?? { field: cls.field, score: 0 };
    entry.score += cls.confidence;
    tallies.set(cls.roleFamily, entry);
  }
  // The major is a strong prior even before any experience.
  if (major) {
    const cls = classifyField(major, '', '');
    if (cls.roleFamily !== 'other') {
      const entry = tallies.get(cls.roleFamily) ?? { field: cls.field, score: 0 };
      entry.score += 1.5;
      tallies.set(cls.roleFamily, entry);
    }
    if (/statistic|data/i.test(major)) bump(tallies, 'data-science', 'Data & Analytics', 1.5);
    if (/computer|software/i.test(major)) bump(tallies, 'swe-general', 'Software Engineering', 1.5);
    if (/math|physics|financ|econom/i.test(major)) bump(tallies, 'quant-research', 'Quantitative Finance', 0.8);
  }
  if (keywords.some((k) => keywordCategory(k) === 'concept' && /learning|AI/i.test(k))) bump(tallies, 'machine-learning', 'AI & Machine Learning', 1);
  const ranked = [...tallies.entries()].sort((a, b) => b[1].score - a[1].score);
  const roleFamilies = ranked.slice(0, 5).map(([family]) => family);
  const interests = [...new Set(ranked.map(([, v]) => v.field))].slice(0, 4);

  return {
    name,
    email,
    phone,
    linkedin_url,
    github_url,
    portfolio_url,
    school,
    degree_level,
    major,
    minor,
    grad_month,
    grad_year,
    class_year,
    gpa,
    skills,
    keywords,
    interests,
    roleFamilies,
  };
}

function bump(map: Map<string, { field: Field; score: number }>, family: string, field: Field, by: number) {
  const entry = map.get(family) ?? { field, score: 0 };
  entry.score += by;
  map.set(family, entry);
}
