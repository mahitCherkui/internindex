'use client';

import { useMemo, useState } from 'react';
import { logoDomains, logoUrl } from '@/lib/logo';

/**
 * The employer's real logo. Candidate domains are tried in order (curated map,
 * homepage, careers site, ATS slug, name guess); a domain the favicon service
 * doesn't know answers 404 or a 16px placeholder, which moves on to the next.
 * When none works, a monogram on a stable hue keeps the row anchored.
 */
export function CompanyLogo({
  company,
  companyUrl,
  applyUrl,
  size = 40,
}: {
  company: string;
  companyUrl?: string | null;
  applyUrl?: string | null;
  size?: number;
}) {
  const candidates = useMemo(
    () => logoDomains({ company, company_url: companyUrl, apply_url: applyUrl }),
    [company, companyUrl, applyUrl],
  );
  const [index, setIndex] = useState(0);
  const domain = candidates[index];

  const initials = company
    .replace(/\b(?:inc|llc|ltd|corp|the)\b\.?/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  let hash = 0;
  for (const ch of company) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 4.5),
        fontSize: size * 0.36,
        background: domain ? '#ffffff' : `hsl(${hue} 60% 93%)`,
        color: `hsl(${hue} 45% 30%)`,
        border: '1px solid var(--line)',
      }}
      aria-hidden
    >
      {domain ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={domain}
          src={logoUrl(domain, size > 48 ? 128 : 64)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
          onLoad={(e) => {
            // The service's "unknown site" globe is 16px; a real logo is larger.
            if (e.currentTarget.naturalWidth <= 16) setIndex((i) => i + 1);
          }}
          style={{ width: '72%', height: '72%', objectFit: 'contain' }}
        />
      ) : (
        initials || '?'
      )}
    </span>
  );
}
