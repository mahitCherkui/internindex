'use client';

import { useState } from 'react';
import type { ProfileView } from '@/lib/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const WORK_AUTH_TEXT: Record<string, string> = {
  'us-citizen': 'I am a U.S. citizen and authorized to work in the U.S. without sponsorship.',
  'permanent-resident': 'I am a U.S. permanent resident and authorized to work in the U.S. without sponsorship.',
  'needs-sponsorship': 'I will require visa sponsorship (e.g. CPT/OPT) to work in the U.S.',
  other: '',
};

/**
 * Your standard application answers, one click to copy, for pasting into
 * Workday / Greenhouse forms. Values come from your profile; edit them there.
 */
export function QuickCopy({
  profile,
  onCopied,
}: {
  profile: ProfileView | null;
  onCopied?: (label: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!profile) {
    return (
      <p className="text-[0.8125rem]" style={{ color: 'var(--ink-secondary)' }}>
        Sign in and fill in your <a className="link" href="/profile#quick-copy">profile</a> to keep your standard answers here.
      </p>
    );
  }

  const [first, ...rest] = (profile.name ?? '').trim().split(/\s+/);
  const gradDate =
    profile.grad_year != null
      ? `${profile.grad_month ? `${MONTHS[profile.grad_month - 1]} ` : ''}${profile.grad_year}`
      : null;

  const rows: [label: string, value: string | null | undefined][] = [
    ['Full name', profile.name],
    ['First name', first || null],
    ['Last name', rest.join(' ') || null],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['School', profile.school],
    ['Degree', profile.degree_level ? `${profile.degree_level}${profile.major ? ` in ${profile.major}` : ''}` : profile.major],
    ['Major', profile.major],
    ['Minor', profile.minor],
    ['Graduation date', gradDate],
    ['GPA', profile.gpa != null ? profile.gpa.toFixed(2) : null],
    ['LinkedIn', profile.linkedin_url],
    ['GitHub', profile.github_url],
    ['Portfolio / website', profile.portfolio_url],
    ['Pronouns', profile.pronouns],
    ['Work authorization', profile.work_auth ? WORK_AUTH_TEXT[profile.work_auth] : null],
    ['Authorized to work in the U.S.?', profile.work_auth ? (profile.work_auth === 'needs-sponsorship' ? 'Yes, with sponsorship' : 'Yes') : null],
    ['Will you require sponsorship?', profile.work_auth ? (profile.work_auth === 'needs-sponsorship' ? 'Yes' : 'No') : null],
    ...Object.entries(profile.quick_answers ?? {}),
  ];
  const filled = rows.filter(([, v]) => v && String(v).trim());

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      onCopied?.(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      onCopied?.('nothing (clipboard blocked)');
    }
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {filled.map(([label, value]) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => copy(label, String(value))}
              className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
              aria-label={`Copy ${label}`}
            >
              <span className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium tracking-wide uppercase" style={{ color: 'var(--ink-muted)' }}>
                {label}
                <span style={{ color: copied === label ? 'var(--good-text)' : 'var(--ink-muted)' }}>{copied === label ? 'Copied ✓' : 'Copy'}</span>
              </span>
              <span className="mt-0.5 block truncate text-[0.8125rem]">{value}</span>
            </button>
          </li>
        ))}
      </ul>
      {filled.length < 8 ? (
        <p className="text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
          Add your phone, links and graduation date on your <a className="link" href="/profile#quick-copy">profile</a> to fill this in.
        </p>
      ) : (
        <a className="link text-[0.75rem]" href="/profile#quick-copy">
          Edit answers
        </a>
      )}
    </div>
  );
}
