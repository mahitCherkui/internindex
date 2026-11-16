'use client';

import { useEffect, useState } from 'react';
import type { Digest } from '@/lib/digest';
import { formatDate } from '@/lib/util';

/**
 * The in-app daily digest, shown above search results: new roles matching
 * your saved searches in the last 24 hours, and saved roles closing within
 * three days. Dismissing it marks it read until something new arrives.
 */
export function DigestBanner() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/digest')
      .then((r) => (r.ok ? r.json() : null))
      .then(setDigest)
      .catch(() => {});
  }, []);

  if (!digest || dismissed) return null;
  const newCount = digest.sections.reduce((n, s) => n + s.total, 0);
  // Already read today and nothing urgent: stay out of the way.
  const readToday = digest.seenAt != null && digest.generatedAt - digest.seenAt < 20 * 3600;
  if ((newCount === 0 || readToday) && digest.closingSoon.length === 0) return null;

  const dismiss = () => {
    setDismissed(true);
    void fetch('/api/digest', { method: 'POST' });
  };

  return (
    <section className="mx-4 mt-3 rounded-xl border p-3.5 sm:mx-6" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }} aria-label="Daily digest">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem]">
          <span aria-hidden>📬 </span>
          <strong>Today&rsquo;s digest:</strong>{' '}
          {newCount > 0 && !readToday ? `${newCount} new role${newCount === 1 ? '' : 's'} match your saved searches` : null}
          {newCount > 0 && !readToday && digest.closingSoon.length ? ' · ' : null}
          {digest.closingSoon.length ? (
            <span style={{ color: 'var(--critical)' }}>
              {digest.closingSoon.length} saved role{digest.closingSoon.length === 1 ? '' : 's'} closing within 3 days
            </span>
          ) : null}
        </p>
        <div className="flex gap-1.5">
          <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
            Mark read
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-3 space-y-3 text-[0.8125rem]">
          {digest.closingSoon.length ? (
            <div>
              <p className="label">Closing soon</p>
              <ul className="space-y-1">
                {digest.closingSoon.map((c) => (
                  <li key={c.id}>
                    <a className="link" href={c.apply_url} target="_blank" rel="noopener noreferrer">
                      {c.company} · {c.title}
                    </a>{' '}
                    <span style={{ color: 'var(--critical)' }}>closes {formatDate(c.deadline)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!readToday
            ? digest.sections.map((section) => (
                <div key={section.searchId}>
                  <p className="label">
                    {section.name} · {section.total} new
                  </p>
                  <ul className="space-y-1">
                    {section.rows.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                        <a className="link" href={r.apply_url} target="_blank" rel="noopener noreferrer">
                          {r.company} · {r.title}
                        </a>
                        {r.match ? <span style={{ color: 'var(--ink-muted)' }}>{r.match.score}% match</span> : null}
                      </li>
                    ))}
                  </ul>
                  {section.total > section.rows.length ? (
                    <a className="link text-[0.75rem]" href={`/?${section.query}&new=1`}>
                      See all {section.total}
                    </a>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}
