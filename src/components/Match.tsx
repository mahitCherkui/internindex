/** Match score visuals shared by the card and the detail panel. */

export function matchLabel(score: number): string {
  return score >= 80 ? 'Strong match' : score >= 60 ? 'Good match' : score >= 40 ? 'Fair match' : 'Low match';
}

function ringColor(score: number): string {
  return score >= 80 ? '#3ee8a0' : score >= 60 ? '#8ee86b' : score >= 40 ? '#f5c451' : '#f08a6b';
}

/** A circular gauge. The number and the label always accompany the colour. */
export function MatchRing({ score, size = 84, stroke = 7, onDark = true }: { score: number; size?: number; stroke?: number; onDark?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% match`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={onDark ? 'rgba(255,255,255,0.12)' : 'var(--surface-3)'} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={ringColor(pct)}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 500ms cubic-bezier(0.2,0.8,0.2,1)' }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.27}
        fontWeight={700}
        fill={onDark ? '#ffffff' : 'var(--ink-primary)'}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {pct}%
      </text>
    </svg>
  );
}

/* Small inline icons for the fact grid. 15px, currentColor, no dependency. */
const base = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const Icon = {
  pin: () => (
    <svg {...base}>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
  briefcase: () => (
    <svg {...base}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </svg>
  ),
  building: () => (
    <svg {...base}>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M3 21h18" />
    </svg>
  ),
  calendar: () => (
    <svg {...base}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  ),
  dollar: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3-1.6M12 6.5v1.5M12 16v1.5" />
    </svg>
  ),
  cap: () => (
    <svg {...base}>
      <path d="m2 9 10-5 10 5-10 5Z" />
      <path d="M6 11v5c2 2 10 2 12 0v-5M22 9v6" />
    </svg>
  ),
  heart: ({ filled = false }: { filled?: boolean }) => (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.4 3.9 4.5 7 4.5c2 0 3.3 1 5 3 1.7-2 3-3 5-3 3.1 0 5.4 2.9 4.2 6.2C19.5 15.4 12 20 12 20Z" />
    </svg>
  ),
  ban: () => (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  ),
  check: () => (
    <svg {...base} strokeWidth={2.4}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  lock: () => (
    <svg {...base}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  bolt: () => (
    <svg {...base}>
      <path d="M13 3 4 14h7l-1 7 9-11h-7Z" />
    </svg>
  ),
};
