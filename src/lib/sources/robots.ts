import { NO_FETCH_HOSTS } from '../no-fetch';
import { fetchText } from './http';

/**
 * robots.txt compliance for the page enricher, which (unlike the ATS
 * adapters) requests employer career pages directly.
 *
 * Rules are read for `User-agent: *` and for agents named "InternIndex",
 * longest match wins, `Allow` beats `Disallow` on a tie, `*` and `$` are
 * supported. A robots.txt that can't be fetched counts as "allow" (the web
 * convention), except for hosts on the never-fetch list, which are always
 * refused regardless of what their robots.txt says.
 */

interface Rule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

const cache = new Map<string, Promise<Rule[]>>();

function compile(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string, agent = 'internindex'): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== 'allow' && key !== 'disallow')) continue;
    if (key === 'disallow' && value === '') continue; // "Disallow:" with no path allows everything
    current.rules.push({ allow: key === 'allow', pattern: compile(value), length: value.length });
  }

  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

export function isAllowedBy(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!rule.pattern.test(pathAndQuery)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** May this app request `url`? */
export async function robotsAllows(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (NO_FETCH_HOSTS.test(u.hostname)) return false;
  const origin = u.origin;
  let rules = cache.get(origin);
  if (!rules) {
    rules = fetchText(`${origin}/robots.txt`, { timeoutMs: 10_000, retries: 0, tolerate: [401, 403, 404, 410] })
      .then((text) => (text ? parseRobots(text) : []))
      .catch(() => []);
    cache.set(origin, rules);
  }
  return isAllowedBy(await rules, `${u.pathname}${u.search}`);
}
