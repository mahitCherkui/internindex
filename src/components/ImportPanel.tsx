'use client';

import { useState } from 'react';

interface Outcome {
  id: string | null;
  via: 'ats' | 'pasted' | 'skipped';
  message: string;
}

/**
 * Import postings from sites the app deliberately doesn't crawl (LinkedIn,
 * Handshake, Indeed, Jobright, Wellfound, Built In, Levels.fyi, …). Paste one
 * posting, or a CSV of saved jobs; imported roles land on your shortlist.
 */
export function ImportPanel({ onImported }: { onImported?: () => void }) {
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [text, setText] = useState('');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/import-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'csv' ? { csv } : { url, title, company, location, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      setResults(data.results);
      if (data.imported > 0) {
        setUrl('');
        setTitle('');
        setCompany('');
        setLocation('');
        setText('');
        setCsv('');
        onImported?.();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  return (
    <form className="card space-y-3 p-4" onSubmit={submit}>
      <p className="text-[0.8125rem]" style={{ color: 'var(--ink-secondary)' }}>
        LinkedIn, Handshake, Indeed, Glassdoor, Jobright, Wellfound, Built In, Levels.fyi, Otta and
        RippleMatch don&rsquo;t allow automated collection, so they&rsquo;re never crawled. Paste a
        posting here instead. If it links to the company&rsquo;s own application page (Greenhouse,
        Workday, Lever…), that original posting is fetched and stored, and the employer&rsquo;s
        board is tracked from then on.
      </p>

      <div className="seg" role="tablist" aria-label="Import type">
        <button type="button" role="tab" aria-selected={mode === 'one'} className="seg-item" onClick={() => setMode('one')}>
          One posting
        </button>
        <button type="button" role="tab" aria-selected={mode === 'csv'} className="seg-item" onClick={() => setMode('csv')}>
          Saved-jobs CSV
        </button>
      </div>

      {mode === 'one' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="label">Posting URL</span>
            <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/… or the company's apply link" />
          </label>
          <label>
            <span className="label">Title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Software Engineer Intern" />
          </label>
          <label>
            <span className="label">Company</span>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Location (optional)</span>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Austin, TX" />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Posting text</span>
            <textarea
              className="textarea"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the full job description, including qualifications. Requirements, keywords, pay and eligibility are parsed from it."
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className="label">CSV file or text</span>
            <input className="text-[0.75rem]" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <textarea
            className="textarea"
            rows={5}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'title,company,url,location\nData Science Intern,Acme,https://…,Austin, TX'}
            aria-label="CSV contents"
          />
          <p className="text-[0.6875rem]" style={{ color: 'var(--ink-muted)' }}>
            Needs title and company columns; url, location and description are used when present. Up to 60 rows per import.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (mode === 'one' ? !url && !text : !csv.trim())}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        {error ? (
          <span className="text-[0.75rem]" style={{ color: 'var(--critical)' }} role="alert">
            {error}
          </span>
        ) : null}
      </div>

      {results ? (
        <ul className="space-y-1 text-[0.75rem]" aria-live="polite">
          {results.map((r, i) => (
            <li key={i} style={{ color: r.id ? 'var(--good-text)' : 'var(--ink-secondary)' }}>
              {r.id ? '✓' : '•'} {r.message}
              {r.id ? (
                <>
                  {' '}
                  <a className="link" href={`/?bookmarked=1`}>
                    View in shortlist
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
