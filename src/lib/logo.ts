/**
 * Company logo resolution: which web domains could carry this employer's
 * logo, best guess first. The UI tries each through a favicon service and
 * falls back to a monogram, so a wrong guess costs one failed image request.
 *
 * Pure and dependency-free, so client components can import it.
 */

/** Employers whose domain isn't derivable from their name or ATS slug. */
const KNOWN: Record<string, string> = {
  // Big tech
  google: 'google.com', alphabet: 'google.com', meta: 'meta.com', facebook: 'meta.com', apple: 'apple.com',
  amazon: 'amazon.com', 'amazon-web-services': 'aws.amazon.com', aws: 'aws.amazon.com', microsoft: 'microsoft.com',
  netflix: 'netflix.com', nvidia: 'nvidia.com', tesla: 'tesla.com', ibm: 'ibm.com', intel: 'intel.com',
  oracle: 'oracle.com', salesforce: 'salesforce.com', adobe: 'adobe.com', tiktok: 'tiktok.com',
  bytedance: 'bytedance.com', linkedin: 'linkedin.com', uber: 'uber.com', lyft: 'lyft.com', airbnb: 'airbnb.com',
  doordash: 'doordash.com', snap: 'snap.com', 'snap-inc': 'snap.com', spotify: 'spotify.com', x: 'x.com',
  twitter: 'x.com', openai: 'openai.com', anthropic: 'anthropic.com', 'scale-ai': 'scale.com', databricks: 'databricks.com',
  palantir: 'palantir.com', 'palantir-technologies': 'palantir.com', cisco: 'cisco.com', qualcomm: 'qualcomm.com',
  amd: 'amd.com', 'advanced-micro-devices': 'amd.com', 'texas-instruments': 'ti.com', samsung: 'samsung.com',
  'hewlett-packard-enterprise': 'hpe.com', hp: 'hp.com', dell: 'dell.com', 'dell-technologies': 'dell.com',
  vmware: 'vmware.com', servicenow: 'servicenow.com', workday: 'workday.com', intuit: 'intuit.com',
  atlassian: 'atlassian.com', shopify: 'shopify.com', pinterest: 'pinterest.com', reddit: 'reddit.com',
  roblox: 'roblox.com', 'epic-games': 'epicgames.com', 'riot-games': 'riotgames.com', 'electronic-arts': 'ea.com',
  'activision-blizzard': 'activisionblizzard.com', 'the-walt-disney-company': 'disney.com', disney: 'disney.com',
  'warner-bros': 'wbd.com', 'warner-bros-discovery': 'wbd.com', spacex: 'spacex.com', 'blue-origin': 'blueorigin.com',
  'anduril-industries': 'anduril.com', anduril: 'anduril.com', waymo: 'waymo.com', zoox: 'zoox.com',
  'lockheed-martin': 'lockheedmartin.com', 'northrop-grumman': 'northropgrumman.com', boeing: 'boeing.com',
  rtx: 'rtx.com', raytheon: 'rtx.com', 'general-motors': 'gm.com', ford: 'ford.com', 'ford-motor-company': 'ford.com',
  rivian: 'rivian.com', 'micron-technology': 'micron.com', micron: 'micron.com', 'applied-materials': 'appliedmaterials.com',
  'analog-devices': 'analog.com', 'marvell': 'marvell.com', broadcom: 'broadcom.com', arm: 'arm.com',
  'cadence-design-systems': 'cadence.com', synopsys: 'synopsys.com', 'palo-alto-networks': 'paloaltonetworks.com',
  crowdstrike: 'crowdstrike.com', cloudflare: 'cloudflare.com', datadog: 'datadoghq.com', snowflake: 'snowflake.com',
  mongodb: 'mongodb.com', figma: 'figma.com', notion: 'notion.so', 'notion-labs': 'notion.so', linear: 'linear.app',
  vercel: 'vercel.com', supabase: 'supabase.com', github: 'github.com', gitlab: 'gitlab.com', duolingo: 'duolingo.com',
  // Quant and trading
  'jane-street': 'janestreet.com', 'jane-street-capital': 'janestreet.com', citadel: 'citadel.com',
  'citadel-securities': 'citadelsecurities.com', 'two-sigma': 'twosigma.com', 'hudson-river-trading': 'hudsonrivertrading.com',
  hrt: 'hudsonrivertrading.com', 'jump-trading': 'jumptrading.com', 'jump-trading-group': 'jumptrading.com',
  imc: 'imc.com', 'imc-trading': 'imc.com', optiver: 'optiver.com', 'susquehanna-international-group': 'sig.com',
  'susquehanna-international-group-llp': 'sig.com', sig: 'sig.com', susquehanna: 'sig.com', 'd-e-shaw': 'deshaw.com',
  'de-shaw': 'deshaw.com', 'the-d-e-shaw-group': 'deshaw.com', 'five-rings': 'fiverings.com', 'five-rings-llc': 'fiverings.com',
  'akuna-capital': 'akunacapital.com', drw: 'drw.com', 'tower-research-capital': 'tower-research.com',
  'squarepoint-capital': 'squarepoint-capital.com', 'virtu-financial': 'virtu.com', virtu: 'virtu.com',
  'flow-traders': 'flowtraders.com', point72: 'point72.com', aqr: 'aqr.com', 'aqr-capital-management': 'aqr.com',
  bridgewater: 'bridgewater.com', 'bridgewater-associates': 'bridgewater.com', schonfeld: 'schonfeld.com',
  'millennium-management': 'mlp.com', millennium: 'mlp.com', 'balyasny-asset-management': 'bamfunds.com',
  'old-mission': 'oldmissioncapital.com', 'peak6': 'peak6.com', 'wolverine-trading': 'wolverinetrading.com',
  'belvedere-trading': 'belvederetrading.com', 'chicago-trading-company': 'chicagotrading.com', voleon: 'voleon.com',
  'the-voleon-group': 'voleon.com', 'geneva-trading': 'genevatrading.com', 'xtx-markets': 'xtxmarkets.com',
  // Banks and fintech
  'goldman-sachs': 'goldmansachs.com', 'jpmorgan-chase': 'jpmorganchase.com', 'jpmorgan-chase-co': 'jpmorganchase.com',
  'j-p-morgan': 'jpmorgan.com', 'morgan-stanley': 'morganstanley.com', citi: 'citi.com', citigroup: 'citi.com',
  'bank-of-america': 'bankofamerica.com', 'wells-fargo': 'wellsfargo.com', 'capital-one': 'capitalone.com',
  'american-express': 'americanexpress.com', visa: 'visa.com', mastercard: 'mastercard.com', paypal: 'paypal.com',
  stripe: 'stripe.com', plaid: 'plaid.com', ramp: 'ramp.com', brex: 'brex.com', robinhood: 'robinhood.com',
  coinbase: 'coinbase.com', block: 'block.xyz', square: 'squareup.com', chime: 'chime.com', affirm: 'affirm.com',
  sofi: 'sofi.com', mercury: 'mercury.com', 'charles-schwab': 'schwab.com', fidelity: 'fidelity.com',
  'fidelity-investments': 'fidelity.com', blackrock: 'blackrock.com', 'state-street': 'statestreet.com',
  bloomberg: 'bloomberg.com', 'bloomberg-lp': 'bloomberg.com', 'nasdaq': 'nasdaq.com', 'cme-group': 'cmegroup.com',
  'intercontinental-exchange': 'ice.com', 'fannie-mae': 'fanniemae.com', 'freddie-mac': 'freddiemac.com',
  'usaa': 'usaa.com', 'state-farm': 'statefarm.com', 'liberty-mutual': 'libertymutual.com', 'pnc': 'pnc.com',
  'truist': 'truist.com', 'us-bank': 'usbank.com', 'discover': 'discover.com', 'synchrony': 'synchrony.com',
  // Consulting and other large intern programs
  deloitte: 'deloitte.com', 'pwc': 'pwc.com', 'ernst-young': 'ey.com', ey: 'ey.com', kpmg: 'kpmg.com',
  accenture: 'accenture.com', mckinsey: 'mckinsey.com', 'mckinsey-company': 'mckinsey.com', 'boston-consulting-group': 'bcg.com',
  bcg: 'bcg.com', bain: 'bain.com', 'bain-company': 'bain.com', 'booz-allen-hamilton': 'boozallen.com',
  'general-electric': 'ge.com', 'ge-aerospace': 'geaerospace.com', 'ge-healthcare': 'gehealthcare.com', 'ge-vernova': 'gevernova.com',
  '3m': '3m.com', 'johnson-johnson': 'jnj.com', pfizer: 'pfizer.com', 'procter-gamble': 'pg.com', pepsico: 'pepsico.com',
  'the-coca-cola-company': 'coca-colacompany.com', walmart: 'walmart.com', target: 'target.com', 'the-home-depot': 'homedepot.com',
  'cvs-health': 'cvshealth.com', 'unitedhealth-group': 'unitedhealthgroup.com', 'h-e-b': 'heb.com', heb: 'heb.com',
  'dell-technologies-inc': 'dell.com', 'university-of-texas-at-austin': 'utexas.edu',
};

/** Hosts that belong to an ATS or aggregator, never to the employer. */
const NOT_EMPLOYER =
  /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|workable\.com|icims\.com|oraclecloud\.com|jobvite\.com|bamboohr\.com|rippling\.com|recruitee\.com|breezy\.hr|personio\.(?:de|com)|eightfold\.ai|taleo\.net|successfactors\.(?:com|eu)|ultipro\.com|ukg\.com|paylocity\.com|adp\.com|dayforcehcm\.com|applytojob\.com|pinpointhq\.com|gem\.com|teamtailor\.com|simplify\.jobs|github\.com|githubusercontent\.com|ycombinator\.com|linkedin\.com|indeed\.com|glassdoor\.com|joinhandshake\.com|themuse\.com|usajobs\.gov|zintellect\.com|remoteok\.com|jobicy\.com|arbeitnow\.com|google\.com\/about)$/i;

/** Two-label suffixes where the registrable domain has three labels. */
const SECOND_LEVEL = /\.(?:co|com|ac|gov|org|net|edu)\.[a-z]{2}$/i;

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\d?\./, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  return parts.slice(SECOND_LEVEL.test(h) ? -3 : -2).join('.');
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[.,'’()]/g, ' ')
    .replace(/\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|plc|gmbh|lp|llp|the|co)\b/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Candidate domains for an employer's logo, most reliable first:
 * a curated map, the employer's own homepage, its careers-site domain, the
 * slug it uses on its ATS, then a guess from the name.
 */
export function logoDomains(input: {
  company: string;
  company_url?: string | null;
  apply_url?: string | null;
  source?: string | null;
}): string[] {
  const out: string[] = [];
  const add = (d: string | null | undefined) => {
    if (d && !out.includes(d) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) out.push(d);
  };

  const key = companyKey(input.company);
  add(KNOWN[key] ?? KNOWN[key.replace(/-(?:group|holdings|technologies|technology|labs|systems|capital|inc)$/, '')]);

  for (const url of [input.company_url, input.apply_url]) {
    const host = hostOf(url);
    if (host && !NOT_EMPLOYER.test(host)) add(registrableDomain(host));
  }

  // The employer's slug on its ATS is usually its name or domain stem.
  const apply = hostOf(input.apply_url);
  const slug = (() => {
    if (!apply || !input.apply_url) return null;
    const path = new URL(input.apply_url).pathname.split('/').filter(Boolean);
    if (/myworkdayjobs\.com$/.test(apply)) return apply.split('.')[0];
    if (/greenhouse\.io$|lever\.co$|ashbyhq\.com$|smartrecruiters\.com$|workable\.com$/.test(apply)) return path[0] ?? null;
    if (/bamboohr\.com$|breezy\.hr$|recruitee\.com$|personio\./.test(apply)) return apply.split('.')[0];
    return null;
  })();
  if (slug && /^[a-z0-9-]{2,40}$/i.test(slug)) add(`${slug.toLowerCase().replace(/(?:careers|jobs|usa|us|inc)$/, '')}.com`);

  const compact = key.replace(/-/g, '');
  if (compact.length >= 2) add(`${compact}.com`);
  const first = key.split('-')[0];
  if (first && first !== compact && first.length >= 4) add(`${first}.com`);

  return out.slice(0, 4);
}

/** A favicon service URL that answers 404 for unknown domains, so the fallback chain can move on. */
export function logoUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
