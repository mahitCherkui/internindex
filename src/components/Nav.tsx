'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase/client';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/', label: 'Find internships', short: 'Jobs', icon: SearchIcon, exact: true },
  { href: '/dashboard', label: 'Dashboard', short: 'Home', icon: GridIcon },
  { href: '/tracker', label: 'Applications', short: 'Tracker', icon: ListIcon },
  { href: '/saved', label: 'Saved & shortlist', short: 'Saved', icon: StarIcon },
  { href: '/calendar', label: 'Calendar', short: 'Calendar', icon: CalendarIcon },
  { href: '/insights', label: 'Insights', short: 'Insights', icon: ChartIcon },
  { href: '/profile', label: 'Profile & resume', short: 'Resume', icon: UserIcon },
  { href: '/sources', label: 'Sources & sync', short: 'Sources', icon: RefreshIcon },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<{ open: number; active: number } | null>(null);
  const [auth, setAuth] = useState<{ authenticated: boolean; email: string | null } | null>(null);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCounts({ open: data.catalog?.open ?? 0, active: data.dashboard?.active ?? 0 });
        setAuth({ authenticated: Boolean(data.authenticated), email: data.email ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const signOut = async () => {
    await createSupabaseBrowser().auth.signOut();
    router.push('/');
    router.refresh();
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Mobile bar */}
      <div
        className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-4 py-2.5 lg:hidden"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
      >
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-semibold">InternIndex</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      <nav
        className={`no-print z-20 w-full shrink-0 border-b lg:sticky lg:top-0 lg:h-screen lg:w-[84px] lg:border-r lg:border-b-0 ${
          open ? 'block' : 'hidden lg:block'
        }`}
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
        aria-label="Main navigation"
      >
        <div className="flex h-full flex-col">
          <div className="hidden justify-center py-4 lg:flex">
            <Link href="/" aria-label="InternIndex home">
              <Logo />
            </Link>
          </div>

          <ul className="flex-1 space-y-0.5 p-2 lg:space-y-1">
            {LINKS.map(({ href, label, short, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    title={label}
                    className="relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[0.8125rem] font-medium transition-colors hover:bg-[var(--surface-2)] lg:flex-col lg:gap-1 lg:px-1 lg:py-2.5 lg:text-[0.625rem] lg:font-semibold"
                    style={{
                      background: active ? 'var(--accent-soft)' : undefined,
                      color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                    }}
                  >
                    <span className="lg:scale-125">
                      <Icon />
                    </span>
                    <span className="flex-1 lg:hidden">{label}</span>
                    <span className="hidden lg:block">{short}</span>
                    {href === '/' && counts?.open ? (
                      <span className="tnum text-[0.6875rem] lg:absolute lg:-top-1 lg:right-0 lg:rounded-full lg:bg-[var(--ink-primary)] lg:px-1.5 lg:text-[0.5625rem] lg:text-[var(--surface-1)]" style={{ color: 'var(--ink-muted)' }}>
                        {counts.open.toLocaleString()}
                      </span>
                    ) : null}
                    {href === '/tracker' && counts?.active ? (
                      <span className="tnum text-[0.6875rem] lg:hidden" style={{ color: 'var(--ink-muted)' }}>
                        {counts.active}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden justify-center pb-2 lg:flex">
            <ThemeToggle />
          </div>
          <div
            className="border-t p-3 text-[0.6875rem] leading-relaxed"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
          >
            {auth?.authenticated ? (
              <div className="flex items-center justify-between gap-2 lg:flex-col lg:text-center">
                <p className="min-w-0 truncate lg:hidden" title={auth.email ?? undefined}>
                  {auth.email ?? 'Signed in'}
                </p>
                <span
                  className="hidden h-8 w-8 items-center justify-center rounded-full text-[0.75rem] font-semibold lg:flex"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  title={auth.email ?? undefined}
                  aria-hidden
                >
                  {(auth.email ?? '?')[0]?.toUpperCase()}
                </span>
                <button type="button" className="link shrink-0" onClick={signOut}>
                  Sign out
                </button>
              </div>
            ) : auth ? (
              <p className="lg:hidden">
                <Link href="/login" className="link" style={{ color: 'var(--accent)' }}>
                  Sign in
                </Link>{' '}
                to save searches, shortlist roles, and track applications. Browsing is open to
                everyone.
              </p>
            ) : null}
          </div>
        </div>
      </nav>
    </>
  );
}

/* The compass mark, matching public/favicon.svg. The lighter #0C447C plate is
   the one that holds up against both the light and the dark nav surface. */
function Logo() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="12.8" fill="#0C447C" />
      <circle cx="32" cy="32" r="20.5" fill="none" stroke="#B5D4F4" strokeWidth="5.5" />
      <path d="M42.25 21.75 35.89 38.01 23.16 40.84 25.99 28.11Z" fill="#E6F1FB" />
    </svg>
  );
}

/* Inline 16px icons: no icon dependency, and they inherit currentColor. */
const s = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

function SearchIcon() {
  return (
    <svg {...s}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg {...s}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg {...s}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg {...s}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg {...s}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg {...s}>
      <path d="m12 3 2.9 5.9 6.1.9-4.5 4.4 1.1 6.4L12 17.7 6.4 20.6l1.1-6.4L3 9.8l6.1-.9Z" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...s}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg {...s}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg {...s}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg {...s}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
