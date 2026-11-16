import { SKILLS } from './skills';

/**
 * ATS keywords: the specific skills, tools and phrases a posting repeats, which
 * are what applicant-tracking systems and recruiters screen resumes against.
 *
 * Built on a curated vocabulary (the skill list plus concept phrases), never a
 * generic n-gram extractor, so the output is clean enough to tell a student
 * "put these exact words on your resume".
 */

export type KeywordCategory = 'language' | 'framework' | 'tool' | 'concept' | 'coursework' | 'soft' | 'domain';

interface Term {
  name: string;
  re: RegExp;
  category: KeywordCategory;
}

/** Concept phrases recruiters screen for, beyond named tools. */
const CONCEPTS: Term[] = [
  // Engineering concepts.
  { name: 'Distributed systems', re: /\bdistributed\s+systems?\b/i, category: 'concept' },
  { name: 'System design', re: /\bsystems?\s+design\b|\bsystem\s+architecture\b/i, category: 'concept' },
  { name: 'Microservices', re: /\bmicro-?services?\b/i, category: 'concept' },
  { name: 'APIs', re: /\bAPIs?\b(?!\s+key)/, category: 'concept' },
  { name: 'Cloud computing', re: /\bcloud\s+(?:computing|infrastructure|platforms?|services)\b/i, category: 'concept' },
  { name: 'Concurrency', re: /\bconcurren(?:cy|t)\b|\bmulti-?thread/i, category: 'concept' },
  { name: 'Low latency', re: /\blow[-\s]latency\b|\bhigh[-\s]performance\b/i, category: 'concept' },
  { name: 'Unit testing', re: /\bunit\s+test|\btest[-\s]driven\b|\bautomated\s+test/i, category: 'concept' },
  { name: 'Debugging', re: /\bdebug(?:ging)?\b|\btroubleshoot/i, category: 'concept' },
  { name: 'Code review', re: /\bcode\s+reviews?\b/i, category: 'concept' },
  { name: 'Full-stack development', re: /\bfull[-\s]?stack\b/i, category: 'concept' },
  { name: 'Backend development', re: /\bback[-\s]?end\b/i, category: 'concept' },
  { name: 'Frontend development', re: /\bfront[-\s]?end\b/i, category: 'concept' },
  { name: 'Data pipelines', re: /\bdata\s+pipelines?\b|\bETL\b|\bELT\b/, category: 'concept' },
  { name: 'Data modeling', re: /\bdata\s+model(?:l)?ing\b/i, category: 'concept' },
  { name: 'Data visualization', re: /\bdata\s+visuali[sz]ation\b|\bdashboards?\b/i, category: 'concept' },
  { name: 'Data analysis', re: /\bdata\s+analy(?:sis|tics|ze)\b/i, category: 'concept' },
  { name: 'Machine learning', re: /\bmachine\s+learning\b/i, category: 'concept' },
  { name: 'Deep learning', re: /\bdeep\s+learning\b|\bneural\s+networks?\b/i, category: 'concept' },
  { name: 'Statistical modeling', re: /\bstatistical\s+(?:model|analysis|method|inference)/i, category: 'concept' },
  { name: 'A/B testing', re: /\bA\/B\s+test|\bexperiment(?:ation|al\s+design)\b|\bcausal\s+inference\b/i, category: 'concept' },
  { name: 'Predictive modeling', re: /\bpredictive\s+model|\bforecasting\b/i, category: 'concept' },
  { name: 'Time series', re: /\btime[-\s]series\b/i, category: 'concept' },
  { name: 'Optimization', re: /\b(?:mathematical|numerical|convex)\s+optimization\b|\boptimization\s+(?:problems|algorithms)\b/i, category: 'concept' },
  { name: 'Feature engineering', re: /\bfeature\s+engineering\b/i, category: 'concept' },
  { name: 'Model deployment', re: /\bmodel\s+(?:deployment|serving)\b|\bMLOps\b/i, category: 'concept' },
  { name: 'Reinforcement learning', re: /\breinforcement\s+learning\b/i, category: 'concept' },
  { name: 'Generative AI', re: /\bgenerative\s+AI\b|\bgen\s?AI\b|\bprompt\s+engineering\b|\bRAG\b/, category: 'concept' },
  { name: 'Market making', re: /\bmarket[-\s]making\b/i, category: 'domain' },
  { name: 'Trading strategies', re: /\btrading\s+strateg|\balpha\s+(?:research|generation|signals?)\b/i, category: 'domain' },
  { name: 'Derivatives / options', re: /\bderivatives?\b|\boptions?\s+(?:pricing|trading|theory)\b/i, category: 'domain' },
  { name: 'Risk management', re: /\brisk\s+(?:management|models?|analysis)\b/i, category: 'domain' },
  { name: 'Payments', re: /\bpayments?\s+(?:infrastructure|systems|processing|platform)\b/i, category: 'domain' },
  { name: 'Product sense', re: /\bproduct\s+(?:sense|thinking|intuition)\b|\buser\s+empathy\b/i, category: 'concept' },
  { name: 'Roadmapping', re: /\broadmap/i, category: 'concept' },
  { name: 'Usability testing', re: /\busability\s+test|\buser\s+interviews?\b/i, category: 'concept' },
  { name: 'Networking (TCP/IP)', re: /\bTCP\/IP\b|\bcomputer\s+networks?\b|\bnetworking\s+protocols?\b/i, category: 'concept' },
  { name: 'Threat modeling', re: /\bthreat\s+model|\bvulnerability\s+(?:assessment|management)\b|\bpenetration\s+test/i, category: 'concept' },

  // What a resume puts under Relevant Coursework.
  { name: 'Data structures', re: /\bdata\s+structures?\b/i, category: 'coursework' },
  { name: 'Algorithms', re: /\balgorithms?\b/i, category: 'coursework' },
  { name: 'Object-oriented programming', re: /\bobject[-\s]oriented\b|\bOOP\b/, category: 'coursework' },
  { name: 'Operating systems', re: /\boperating\s+systems?\b/i, category: 'coursework' },
  { name: 'Computer architecture', re: /\bcomputer\s+(?:architecture|organization)\b/i, category: 'coursework' },
  { name: 'Probability', re: /\bprobabilit(?:y|ies|istic)\b/i, category: 'coursework' },
  { name: 'Linear algebra', re: /\blinear\s+algebra\b/i, category: 'coursework' },
  { name: 'Calculus', re: /\bcalculus\b/i, category: 'coursework' },
  { name: 'Stochastic processes', re: /\bstochastic\b/i, category: 'coursework' },
  { name: 'Econometrics', re: /\beconometric/i, category: 'coursework' },
  { name: 'Databases', re: /\bdatabases?\b|\bRDBMS\b|\brelational\s+data/i, category: 'coursework' },

  // Soft skills, which belong in bullets that demonstrate them, not a list.
  { name: 'Communication', re: /\bcommunication\s+skills\b|\bcommunicate\s+(?:clearly|effectively)\b|\bwritten\s+and\s+verbal\b/i, category: 'soft' },
  { name: 'Problem solving', re: /\bproblem[-\s]solv/i, category: 'soft' },
  { name: 'Collaboration', re: /\bcollaborat|\bcross[-\s]functional\b|\bteam\s?work\b/i, category: 'soft' },
  { name: 'Ownership', re: /\bownership\b|\bself[-\s](?:starter|motivated|directed)\b|\bindependently\b/i, category: 'soft' },
  { name: 'Attention to detail', re: /\battention\s+to\s+detail\b|\bdetail[-\s]oriented\b/i, category: 'soft' },
  { name: 'Leadership', re: /\bleadership\b/i, category: 'soft' },
];

const LANGUAGES = new Set([
  'Python', 'Java', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift',
  'Kotlin', 'Scala', 'R', 'MATLAB', 'SQL', 'Shell/Bash', 'Verilog/VHDL', 'Assembly', 'Perl', 'Julia',
  'Solidity', 'OCaml', 'Haskell', 'SAS',
]);
const FRAMEWORKS = new Set([
  'React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Django', 'Flask', 'FastAPI', 'Spring', 'Rails',
  'GraphQL', 'React Native', 'Flutter', 'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NumPy', 'JAX',
  'Hugging Face', 'XGBoost', 'Spark', 'Hadoop',
]);

const VOCAB: Term[] = [
  ...SKILLS.map((s) => ({
    ...s,
    category: (LANGUAGES.has(s.name) ? 'language' : FRAMEWORKS.has(s.name) ? 'framework' : 'tool') as KeywordCategory,
  })),
  ...CONCEPTS,
];
const BY_NAME = new Map(VOCAB.map((t) => [t.name, t]));

export function keywordCategory(name: string): KeywordCategory {
  return BY_NAME.get(name)?.category ?? 'tool';
}

/** A keyword with how often it appears and how much it should matter. */
export interface Keyword {
  term: string;
  count: number;
  weight: number;
  category: KeywordCategory;
}

const globalize = (re: RegExp) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);

/**
 * Rank the vocabulary terms a posting uses. Each mention counts once; a term
 * in the title or the must-have section counts extra, one in the nice-to-have
 * section a little extra, so "required: Python" outranks a passing mention.
 */
export function extractKeywords(
  text: string | null | undefined,
  opts: { title?: string; must?: string[]; nice?: string[]; limit?: number } = {},
): Keyword[] {
  const body = text ?? '';
  if (!body.trim() && !opts.title) return [];
  const must = (opts.must ?? []).join('\n');
  const nice = (opts.nice ?? []).join('\n');
  const title = opts.title ?? '';

  const out: Keyword[] = [];
  for (const term of VOCAB) {
    const re = globalize(term.re);
    const count = (body.match(re) ?? []).length + (title.match(re) ?? []).length;
    if (count === 0) continue;
    let weight = Math.min(count, 5);
    if (term.re.test(title)) weight += 3;
    if (must && term.re.test(must)) weight += 3;
    else if (nice && term.re.test(nice)) weight += 1;
    if (term.category === 'soft') weight *= 0.5;
    out.push({ term: term.name, count, weight, category: term.category });
  }
  out.sort((a, b) => b.weight - a.weight || b.count - a.count || a.term.localeCompare(b.term));
  return out.slice(0, opts.limit ?? 20);
}

/** Compact storage form: [["Python",3],["SQL",2]]. Weight survives as order. */
export function packKeywords(keywords: Keyword[]): [string, number][] {
  return keywords.map((k) => [k.term, k.count]);
}

/** Inverse of packKeywords; weights decay with rank. */
export function unpackKeywords(raw: string | null | undefined): Keyword[] {
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as [string, number][];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
      .map(([term, count], i) => ({
        term,
        count: Number(count) || 1,
        weight: Math.max(1, rows.length - i),
        category: keywordCategory(term),
      }));
  } catch {
    return [];
  }
}

/** Every vocabulary term found in a resume, for matching. */
export function resumeKeywords(text: string | null | undefined): string[] {
  const body = text ?? '';
  if (!body.trim()) return [];
  return VOCAB.filter((t) => t.re.test(body)).map((t) => t.name);
}

/** Where on a resume a keyword of this kind belongs. */
export function resumeSection(category: KeywordCategory): string {
  switch (category) {
    case 'language':
    case 'framework':
    case 'tool':
      return 'Skills line, and in a Project or Experience bullet that shows you used it';
    case 'coursework':
      return 'Relevant Coursework (under Education)';
    case 'soft':
      return 'An Experience bullet that demonstrates it; never a bare list';
    case 'domain':
      return 'A Project bullet or your summary line';
    default:
      return 'Project or Experience bullets, in the posting’s exact wording';
  }
}

/** Case-insensitive overlap between posting keywords and the student's terms. */
export function matchKeywords(
  keywords: Keyword[],
  mine: string[],
): { have: Keyword[]; missing: Keyword[]; score: number | null } {
  if (keywords.length === 0 || mine.length === 0) return { have: [], missing: keywords, score: null };
  const owned = new Set(mine.map((s) => s.toLowerCase().trim()));
  const top = keywords.slice(0, 15);
  const have = top.filter((k) => owned.has(k.term.toLowerCase()));
  const missing = top.filter((k) => !owned.has(k.term.toLowerCase()));
  // A posting known only by its title carries one or two keywords; matching
  // both is not a 100% match. Below six keywords the denominator is padded
  // as if the unseen requirements were ones the student doesn't show.
  const MIN_TERMS = 6;
  const avg = top.reduce((s, k) => s + k.weight, 0) / top.length;
  const total = top.reduce((s, k) => s + k.weight, 0) + Math.max(0, MIN_TERMS - top.length) * avg;
  const got = have.reduce((s, k) => s + k.weight, 0);
  return { have, missing, score: total > 0 ? Math.round((got / total) * 100) : null };
}
