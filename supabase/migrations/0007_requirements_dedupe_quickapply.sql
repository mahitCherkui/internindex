-- Requirements breakdown, cross-source dedupe, and quick-apply profile fields.
--
-- Everything here is additive and nullable or defaulted, so existing rows stay
-- valid and the app keeps working before the next sync fills the new columns.
-- The database runs near the Free Plan's 500 MB cap, so the per-listing
-- additions are deliberately compact: a short keyword list and a few scalars.
-- The must-have / nice-to-have split is computed from the stored description
-- when a listing is opened, rather than stored a second time.

-- ---------------------------------------------------------------- catalog

-- Every source a role was seen on, kept on the canonical row by dedupe.
ALTER TABLE internships ADD COLUMN IF NOT EXISTS seen_sources_json TEXT NOT NULL DEFAULT '[]';
-- Top ATS keywords as [["Python",4],["SQL",2],…], weighted by repetition.
ALTER TABLE internships ADD COLUMN IF NOT EXISTS keywords_json TEXT NOT NULL DEFAULT '[]';
-- Graduation window the posting asks for ("graduating Dec 2027 – Jun 2028").
ALTER TABLE internships ADD COLUMN IF NOT EXISTS grad_year_min SMALLINT;
ALTER TABLE internships ADD COLUMN IF NOT EXISTS grad_year_max SMALLINT;
-- Majors the posting names ("Computer Science", "Statistics", …).
ALTER TABLE internships ADD COLUMN IF NOT EXISTS majors_json TEXT NOT NULL DEFAULT '[]';
-- 1 = explicitly open to freshmen/sophomores, 0 = explicitly closed to them,
-- NULL = the posting does not say.
ALTER TABLE internships ADD COLUMN IF NOT EXISTS underclass_ok SMALLINT;
-- When the enrichment pass last tried to fetch this posting's full text, so a
-- link that yields nothing isn't retried every run.
ALTER TABLE internships ADD COLUMN IF NOT EXISTS enriched_at BIGINT;

-- "New in the last 24 hours" reads first_seen_at, the moment this catalog
-- first saw the role, which is the freshest signal across every source.
CREATE INDEX IF NOT EXISTS idx_int_first_seen
  ON internships (first_seen_at DESC) WHERE is_open = 1 AND duplicate_of IS NULL;

-- ---------------------------------------------------------------- profiles

-- Quick-copy answers for application forms.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns TEXT;
-- Free-form saved answers, e.g. {"Why this company?": "…"}.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS quick_answers_json TEXT NOT NULL DEFAULT '{}';
-- Role families inferred from the uploaded resume, used to rank "Recommended".
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_roles_json TEXT NOT NULL DEFAULT '[]';
-- In-app daily digest of new roles matching saved searches.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS digest_enabled SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS digest_seen_at BIGINT;

-- Note for `npm run push-catalog`: the catalog_ingest RPC (0002) copies every
-- column it finds, so apply this migration to the local database you push from
-- as well as to Supabase, or the NOT NULL columns above arrive as NULL.
