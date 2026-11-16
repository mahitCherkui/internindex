import type { ClassYear, Degree } from '../types';

/**
 * Requirements extraction: which qualifications are must-haves and which are
 * nice-to-haves, what graduation window and majors a posting asks for, and
 * whether a freshman or sophomore can apply at all.
 *
 * Deterministic on purpose. Postings follow a small number of conventions
 * ("Minimum Qualifications" / "Preferred Qualifications", "What you'll need" /
 * "Bonus points"), and reading those headings is both cheaper and more
 * predictable than asking a model.
 */

export interface RequirementsSplit {
  must: string[];
  nice: string[];
  /** Whether section headings were found, or the split came from sentence cues. */
  method: 'sections' | 'sentences' | 'none';
}

const MUST_HEADING =
  /^(?:#+\s*)?(?:(?:minimum|basic|required|key|core|essential)\s+(?:qualifications?|requirements?|skills)|requirements?|qualifications?|what\s+you(?:'|’)?(?:ll)?\s+(?:need|bring)|what\s+we(?:'|’)?re\s+looking\s+for|who\s+you\s+are|about\s+you|you\s+(?:have|bring|should\s+have|might\s+be\s+a\s+fit)|must[-\s]haves?|skills\s+(?:and|&)\s+(?:experience|qualifications)|your\s+(?:background|profile|skills)|to\s+be\s+successful|ideal\s+candidate|candidate\s+requirements|eligibility(?:\s+requirements)?)\b[^\n]{0,40}$/i;

/** Headings that name qualifications outright, as opposed to "Who you are". */
const EXPLICIT_MUST =
  /\b(?:qualifications?|requirements?|must[-\s]haves?|eligibility|what\s+you(?:'|’)?(?:ll)?\s+need)\b/i;

const NICE_HEADING =
  /^(?:#+\s*)?(?:(?:preferred|desired|additional|bonus|plus|nice[-\s]to[-\s]have|ideal)\s*(?:qualifications?|requirements?|skills|experience|points?)?|nice[-\s]to[-\s]haves?|bonus\s+points?(?:\s+if)?|it(?:'|’)?s\s+a\s+plus|(?:even\s+)?better\s+if|extra\s+credit|pluses|we(?:'|’)?d\s+love\s+(?:it\s+)?if|it\s+would\s+be\s+great\s+if)\b[^\n]{0,40}$/i;

const STOP_HEADING =
  /^(?:#+\s*)?(?:(?:key\s+)?responsibilit|what\s+you(?:'|’)?ll\s+(?:do|work\s+on|learn)|the\s+role|about\s+(?:us|the\s+(?:team|role|company|job|position|program))|who\s+we\s+are|benefits|perks|what\s+we\s+offer|compensation|pay|salary|base\s+pay|equal\s+(?:opportunity|employment)|eeo|how\s+to\s+apply|application\s+process|our\s+(?:values|culture|mission)|location|why\s+(?:join|you(?:'|’)?ll\s+love)|day\s+to\s+day|in\s+this\s+role|job\s+description|overview|summary|accommodations?|privacy)\b[^\n]{0,40}$/i;

const NICE_CUE = /\b(?:preferred|a\s+plus|is\s+a\s+bonus|bonus|nice\s+to\s+have|desirable|ideally|not\s+required|helpful|advantageous|a\s+big\s+plus)\b/i;
const MUST_CUE = /\b(?:required|must|minimum|at\s+least|need\s+to|you\s+(?:have|are)|currently\s+(?:enrolled|pursuing)|pursuing\s+a|proficien|experience\s+(?:with|in)|knowledge\s+of|familiarity\s+with)\b/i;

/** A heading phrase run into the previous bullet: "…Data structures Bonus points: • Kotlin". */
const INLINE_HEADING =
  /\s+((?:minimum|basic|preferred|required|desired|additional|bonus|nice[-\s]to[-\s]have)\s+(?:qualifications?|requirements?|points?|skills)\s*:|nice[-\s]to[-\s]haves?\s*:|bonus\s+points?\s*:)/gi;

/** Recruiting boilerplate that talks about qualifications without being one. */
const BOILERPLATE =
  /\b(?:meets?\s+the\s+minimum\s+requirements|preferred\s+qualifications\s+are\s+a\s+bonus|encouraged\s+to\s+apply|don(?:'|’)?t\s+meet\s+(?:every|all)|even\s+if\s+you\s+don(?:'|’)?t|equal\s+opportunity\s+employer)\b/i;

const MAX_ITEMS = 10;
const MAX_ITEM_CHARS = 260;

function clean(line: string): string {
  return line
    .replace(/^[\s•·*\-–—▪◦●○]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeading(line: string): boolean {
  const t = line.trim().replace(/[:：]\s*$/, '');
  return t.length > 2 && t.length < 70 && !/[.!?]$/.test(t) && !/^[•·*\-–—]/.test(line.trim());
}

/** Split a posting's qualifications into must-haves and nice-to-haves. */
export function splitRequirements(text: string | null | undefined): RequirementsSplit {
  const body = (text ?? '').replace(/\r/g, '');
  if (!body.trim()) return { must: [], nice: [], method: 'none' };

  // Headings frequently sit inline ("Preferred Qualifications: • Go • Rust"),
  // so break bullets and colon-terminated headings onto their own lines first.
  const lines = body
    .replace(INLINE_HEADING, '\n$1\n')
    .replace(/\s*•\s*/g, '\n• ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const must: string[] = [];
  const nice: string[] = [];
  /** Must-haves under personality headings ("Who you are"), dropped if explicit ones exist. */
  const softMust: string[] = [];
  let mode: 'must' | 'nice' | null = null;
  let explicit = false;
  let sawHeading = false;

  for (let raw of lines) {
    // "Requirements: Python and SQL" carries a heading and its first item.
    const lead = /^([^:•]{3,60}):\s+(\S.*)$/.exec(raw);
    if (lead && (MUST_HEADING.test(lead[1]) || NICE_HEADING.test(lead[1]))) {
      mode = NICE_HEADING.test(lead[1]) ? 'nice' : 'must';
      explicit = EXPLICIT_MUST.test(lead[1]);
      sawHeading = true;
      raw = lead[2];
    }
    const headingText = raw.replace(/[:：]\s*$/, '');
    if (isHeading(raw)) {
      if (NICE_HEADING.test(headingText)) {
        mode = 'nice';
        sawHeading = true;
        continue;
      }
      if (MUST_HEADING.test(headingText)) {
        mode = 'must';
        explicit = EXPLICIT_MUST.test(headingText);
        sawHeading = true;
        continue;
      }
      if (STOP_HEADING.test(headingText)) {
        mode = null;
        continue;
      }
    }
    if (!mode) continue;
    const item = clean(raw);
    if (BOILERPLATE.test(item) || /\?$/.test(item)) continue;
    // A bullet can be one word ("• Java"); free text needs to be a real clause.
    const minLength = /^[•·*\-–—▪◦●○]/.test(raw) ? 2 : 8;
    if (item.length < minLength || item.length > 600) continue;
    // A "must" bullet that says it is preferred is a nice-to-have.
    const target = mode === 'must' && NICE_CUE.test(item) ? nice : mode === 'must' ? (explicit ? must : softMust) : nice;
    target.push(item.length > MAX_ITEM_CHARS ? `${item.slice(0, MAX_ITEM_CHARS - 1)}…` : item);
  }

  if (must.length === 0) must.push(...softMust);
  if (sawHeading && (must.length || nice.length)) {
    return { must: dedupe(must).slice(0, MAX_ITEMS), nice: dedupe(nice).slice(0, MAX_ITEMS), method: 'sections' };
  }

  // No usable headings: fall back to sentence cues.
  const sentences = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map(clean)
    .filter((s) => s.length >= 20 && s.length <= 400);
  for (const sentence of sentences) {
    if (BOILERPLATE.test(sentence) || /\?$/.test(sentence)) continue;
    if (NICE_CUE.test(sentence)) nice.push(sentence);
    else if (MUST_CUE.test(sentence) && /\b(?:experience|knowledge|degree|pursuing|enrolled|proficien|familiar|skills?|ability|GPA|graduat|authori[sz]ed|years?)\b/i.test(sentence)) {
      must.push(sentence);
    }
  }
  return {
    must: dedupe(must).slice(0, MAX_ITEMS),
    nice: dedupe(nice).slice(0, MAX_ITEMS),
    method: must.length || nice.length ? 'sentences' : 'none',
  };
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ------------------------------------------------------------ grad window

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)';
const YEAR = '(20[2-3]\\d)';

const RANGE_PATTERNS: RegExp[] = [
  // "graduating between December 2027 and June 2028", "graduation date from Dec 2027 - Aug 2028"
  new RegExp(`graduat\\w*[^.\\n]{0,40}?(?:between|from)?\\s*(?:${MONTH}\\s*,?\\s*)?${YEAR}\\s*(?:and|to|through|-|–|—)\\s*(?:${MONTH}\\s*,?\\s*)?${YEAR}`, 'i'),
  // "Expected graduation: Dec 2027 – May 2028"
  new RegExp(`(?:${MONTH}\\s*,?\\s*)?${YEAR}\\s*(?:-|–|—|to|through)\\s*(?:${MONTH}\\s*,?\\s*)?${YEAR}\\s+(?:graduat|grads?\\b)`, 'i'),
];

const SINGLE_PATTERNS: RegExp[] = [
  new RegExp(`(?:expected|anticipated|projected)?\\s*graduat\\w*\\s+(?:date\\s+)?(?:in|by|of|no\\s+later\\s+than|before|between|during|:)?\\s*(?:the\\s+)?(?:${MONTH}\\s*(?:of\\s*)?,?\\s*)?${YEAR}`, 'i'),
  new RegExp(`\\bclass\\s+of\\s+${YEAR}`, 'i'),
  new RegExp(`${YEAR}\\s+(?:graduates?|grads?)\\b`, 'i'),
  new RegExp(`(?:${MONTH})\\s+${YEAR}\\s+(?:graduation|graduates?|grads?)\\b`, 'i'),
];

/** The graduation window a posting asks for, as calendar years. */
export function parseGradWindow(text: string | null | undefined): { min: number | null; max: number | null } {
  const body = text ?? '';
  for (const re of RANGE_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      const years = m.slice(1).filter((v) => v && /^20\d\d$/.test(v)).map(Number);
      if (years.length >= 2) {
        const [a, b] = [Math.min(...years), Math.max(...years)];
        if (b - a <= 4) return { min: a, max: b };
      }
    }
  }
  for (const re of SINGLE_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      const year = Number(m.slice(1).find((v) => v && /^20\d\d$/.test(v)));
      if (year) return { min: year, max: year };
    }
  }
  return { min: null, max: null };
}

// ------------------------------------------------------------------ majors

const MAJORS: { name: string; re: RegExp }[] = [
  { name: 'Computer Science', re: /\b[Cc]omputer\s+[Ss]cience\b|\bCS\b(?=[\s,/)]|\s*degree)/ },
  { name: 'Computer Engineering', re: /\bcomputer\s+engineering\b/i },
  { name: 'Electrical Engineering', re: /\b[Ee]lectrical(?:\s+(?:and|&)\s+[Cc]omputer)?\s+[Ee]ngineering\b|\bEE\b|\bECE\b/ },
  { name: 'Software Engineering', re: /\bsoftware\s+engineering\s+(?:degree|major|program)\b|\bdegree\s+in\s+software\s+engineering\b/i },
  { name: 'Data Science', re: /\bdata\s+science\s+(?:degree|major|program)|\b(?:degree|major)\s+in\s+[^.]{0,40}data\s+science\b|\bdata\s+science,/i },
  { name: 'Statistics', re: /\bstatistics\b/i },
  { name: 'Mathematics', re: /\bmathematics\b|\bapplied\s+math\b|\bmath\b(?=[\s,/)])/i },
  { name: 'Physics', re: /\bphysics\b/i },
  { name: 'Operations Research', re: /\boperations\s+research\b/i },
  { name: 'Economics', re: /\beconomics\b/i },
  { name: 'Finance', re: /\b(?:degree|major)\s+in\s+[^.]{0,40}\bfinance\b|\bfinance,\s|\bfinance\s+(?:major|degree)\b/i },
  { name: 'Information Systems', re: /\b[Ii]nformation\s+(?:[Ss]ystems|[Ss]cience|[Tt]echnology)\b|\bMIS\b/ },
  { name: 'Mechanical Engineering', re: /\bmechanical\s+engineering\b/i },
  { name: 'Industrial Engineering', re: /\bindustrial\s+(?:and\s+systems\s+)?engineering\b/i },
  { name: 'Human-Computer Interaction', re: /\b[Hh]uman[-\s][Cc]omputer\s+[Ii]nteraction\b|\bHCI\b/ },
  { name: 'Cognitive Science', re: /\bcognitive\s+science\b/i },
  { name: 'Business', re: /\b[Bb]usiness\s+(?:[Aa]dministration|major|degree)\b|\bBBA\b/ },
  { name: 'Design', re: /\b(?:graphic|interaction|industrial|product)\s+design\s+(?:degree|major|program)\b/i },
  { name: 'STEM / related field', re: /\bSTEM\b|\b(?:or\s+)?(?:a\s+)?[Rr]elated\s+(?:technical\s+|quantitative\s+)?(?:field|discipline|major)\b|\b[Qq]uantitative\s+(?:field|discipline|major)\b/ },
];

/** Majors a posting names. Only scans text near degree language to avoid team names. */
export function parseMajors(text: string | null | undefined): string[] {
  const body = text ?? '';
  const windows = [...body.matchAll(/\b(?:degree|major|majoring|pursuing|studying|enrolled|B\.?S\.?|B\.?A\.?|bachelor|master|field\s+of\s+study|discipline)\b[^\n]{0,180}/gi)]
    .map((m) => m[0])
    .join('\n');
  if (!windows) return [];
  return MAJORS.filter((m) => m.re.test(windows)).map((m) => m.name);
}

// --------------------------------------------------- freshman / sophomore

const UNDERCLASS_PROGRAM =
  /\b(?:freshm[ae]n|sophomores?|first[-\s](?:and|or|&)\s*second[-\s]year|first[-\s]year\s+(?:students?|undergrad)|second[-\s]year\s+(?:students?|undergrad)|early[-\s](?:career|insight|identification|talent)\s+program|STEP\s+intern|Explore\s+(?:intern|program)|underclass(?:men|persons?)?|pre-?university|rising\s+(?:sophomores?|juniors?\s+or\s+sophomores?))\b/i;

const UPPERCLASS_ONLY =
  /\b(?:(?:rising|current)\s+seniors?\s+only|must\s+be\s+(?:a\s+)?(?:rising\s+)?(?:junior|senior)|(?:juniors?|seniors?)\s+(?:and|or)\s+(?:seniors?|graduate\s+students?)\s+only|penultimate\s+year|final[-\s]year\s+students?\s+only|returning\s+to\s+school\s+for\s+(?:at\s+least\s+)?one\s+(?:more\s+)?(?:semester|term|quarter)\s+after|entering\s+(?:your|their)\s+(?:final|senior)\s+year)\b/i;

/**
 * Can a freshman or sophomore apply? 1 = the posting invites them, 0 = it
 * rules them out, null = it doesn't say. `termYear` is the year the
 * internship runs; an underclass student in that summer graduates at least
 * two years later.
 */
export function underclassEligibility(input: {
  text: string;
  title: string;
  classYears: ClassYear[];
  degrees: Degree[];
  gradMin: number | null;
  gradMax: number | null;
  termYear: number | null;
}): 0 | 1 | null {
  const hay = `${input.title}\n${input.text}`;
  if (input.classYears.includes('Freshman') || input.classYears.includes('Sophomore')) return 1;
  if (UNDERCLASS_PROGRAM.test(hay)) return 1;

  // Graduate-only programs.
  if (input.degrees.length > 0 && input.degrees.every((d) => d === 'Masters' || d === 'PhD' || d === 'MBA')) return 0;
  if (/\b(?:phd|ph\.d\.|doctoral|mba|master'?s)\s+(?:intern|student)/i.test(input.title)) return 0;

  if (input.gradMax != null && input.termYear != null) {
    // A sophomore in the summer of termYear graduates in termYear + 2.
    return input.gradMax >= input.termYear + 2 ? 1 : 0;
  }
  if (UPPERCLASS_ONLY.test(hay)) return 0;
  if (
    input.classYears.length > 0 &&
    input.classYears.every((c) => c === 'Junior' || c === 'Senior' || c === 'Graduate')
  ) {
    return 0;
  }
  return null;
}
