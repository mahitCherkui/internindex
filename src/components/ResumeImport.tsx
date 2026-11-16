'use client';

import { useRef, useState } from 'react';
import type { ParsedResume } from '@/lib/parse/resume';
import type { ProfileView } from '@/lib/types';
import { roleFamilyLabel } from '@/lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type FieldKey =
  | 'name' | 'email' | 'phone' | 'school' | 'degree_level' | 'major' | 'minor'
  | 'grad' | 'class_year' | 'gpa' | 'linkedin_url' | 'github_url' | 'portfolio_url';

const LABELS: Record<FieldKey, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  school: 'School',
  degree_level: 'Degree',
  major: 'Major',
  minor: 'Minor',
  grad: 'Graduation',
  class_year: 'Class year',
  gpa: 'GPA',
  linkedin_url: 'LinkedIn',
  github_url: 'GitHub',
  portfolio_url: 'Website',
};

/**
 * Upload a resume (PDF, Word, text) or paste it; review what was read; save.
 * Saving fills the profile, which drives match scores, eligibility checks,
 * the Recommended ranking and the Quick copy answers.
 */
export function ResumeImport({
  onSaved,
  compact = false,
}: {
  onSaved?: (profile: ProfileView) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [result, setResult] = useState<{ text: string; parsed: ParsedResume } | null>(null);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const read = async (body: FormData | { text: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not read that resume.');
      setResult(data);
      const on: Record<string, boolean> = {};
      for (const key of Object.keys(LABELS)) on[key] = true;
      setInclude(on);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    void read(form);
  };

  const save = async () => {
    if (!result) return;
    const p = result.parsed;
    const patch: Record<string, unknown> = {
      resume_text: result.text,
      skills: p.skills,
      preferred_fields: p.interests,
      preferred_roles: p.roleFamilies,
      onboarded: 1,
    };
    const take = (key: FieldKey, value: unknown, column = key) => {
      if (include[key] && value != null && value !== '') patch[column] = value;
    };
    take('name', p.name);
    take('email', p.email);
    take('phone', p.phone);
    take('school', p.school);
    take('degree_level', p.degree_level);
    take('major', p.major);
    take('minor', p.minor);
    take('class_year', p.class_year);
    take('gpa', p.gpa);
    take('linkedin_url', p.linkedin_url);
    take('github_url', p.github_url);
    take('portfolio_url', p.portfolio_url);
    if (include.grad && p.grad_year) {
      patch.grad_year = p.grad_year;
      patch.grad_month = p.grad_month;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save your profile.');
      setResult(null);
      onSaved?.(data.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const p = result.parsed;
    const values: Record<FieldKey, string | null> = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      school: p.school,
      degree_level: p.degree_level,
      major: p.major,
      minor: p.minor,
      grad: p.grad_year ? `${p.grad_month ? `${MONTHS[p.grad_month - 1]} ` : ''}${p.grad_year}` : null,
      class_year: p.class_year,
      gpa: p.gpa != null ? p.gpa.toFixed(2) : null,
      linkedin_url: p.linkedin_url,
      github_url: p.github_url,
      portfolio_url: p.portfolio_url,
    };
    const found = (Object.keys(LABELS) as FieldKey[]).filter((k) => values[k]);
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[0.9375rem] font-semibold">Here&rsquo;s what we read from your resume</p>
          <p className="text-[0.8125rem]" style={{ color: 'var(--ink-secondary)' }}>
            Untick anything that&rsquo;s wrong, then save. You can edit every field on your profile later.
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {found.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5" style={{ borderColor: include[key] ? 'var(--accent)' : 'var(--line)', background: 'var(--surface-1)' }}>
                <input type="checkbox" className="mt-1" checked={!!include[key]} onChange={(e) => setInclude({ ...include, [key]: e.target.checked })} />
                <span className="min-w-0">
                  <span className="block text-[0.6875rem] font-semibold tracking-wide uppercase" style={{ color: 'var(--ink-muted)' }}>
                    {LABELS[key]}
                  </span>
                  <span className="block truncate text-[0.8125rem]">{values[key]}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {p.keywords.length ? (
          <div>
            <p className="label">Skills &amp; keywords found ({p.keywords.length})</p>
            <div className="flex flex-wrap gap-1">
              {p.keywords.map((k) => (
                <span key={k} className="chip chip-good">
                  {k}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {p.roleFamilies.length ? (
          <div>
            <p className="label">Your experience points to</p>
            <div className="flex flex-wrap gap-1">
              {p.roleFamilies.map((f) => (
                <span key={f} className="chip chip-accent">
                  {roleFamilyLabel(f)}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[0.6875rem]" style={{ color: 'var(--ink-muted)' }}>
              Recommended jobs lean toward these; every role type stays searchable.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="text-[0.8125rem]" style={{ color: 'var(--critical)' }} role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save to my profile'}
          </button>
          <button type="button" className="btn btn-pill" onClick={() => setResult(null)} disabled={busy}>
            Start over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors ${compact ? 'px-4 py-5' : 'px-6 py-9'}`}
        style={{ borderColor: dragging ? 'var(--accent)' : 'var(--line-strong)', background: dragging ? 'var(--accent-soft)' : 'var(--surface-2)' }}
        aria-label="Upload your resume"
      >
        <span className="text-2xl" aria-hidden>
          📄
        </span>
        <p className="mt-1.5 text-[0.9375rem] font-semibold">{busy ? 'Reading your resume…' : 'Drop your resume here, or click to upload'}</p>
        <p className="mt-0.5 text-[0.75rem]" style={{ color: 'var(--ink-muted)' }}>
          PDF, Word (.docx) or .txt, up to 5 MB. Read on the server, never shared.
        </p>
        <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      <button type="button" className="link text-[0.75rem]" onClick={() => setShowPaste((v) => !v)}>
        {showPaste ? 'Hide' : 'Or paste the text instead'}
      </button>
      {showPaste ? (
        <div className="space-y-2">
          <textarea className="textarea" rows={7} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste your resume text…" aria-label="Resume text" />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || paste.trim().length < 80} onClick={() => read({ text: paste })}>
            Read resume
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="text-[0.8125rem]" style={{ color: 'var(--critical)' }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
