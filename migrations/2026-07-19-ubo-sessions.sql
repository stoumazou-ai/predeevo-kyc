-- ============================================================================
-- UBO self-service links — session table + per-person document linkage
-- Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS / DROP POLICY).
-- ============================================================================
-- Flow: the applicant clicks "Send KYC link" on a UBO's Step 2 card. The form
-- inserts a kyc_ubo_sessions row and shows a QR + copy link (+ email via edge
-- function). The UBO opens kyc.predeevo.com/ubo.html?u=<session id> on their
-- own device and completes: identity form + passport/ID + proof of address +
-- CV uploads + live selfie. Their answers land in the session row (fields
-- jsonb); their files go straight to storage + kyc_documents tagged with
-- person_label. The applicant's open form polls the session and, on
-- completion, adopts the answers into the Step 2 card so the normal
-- save/submit path persists them to kyc_shareholders.
-- RLS: same predicate as everything else — sessions only work while the
-- parent invitation is still pending and unexpired.
-- ============================================================================

-- 1) Tag documents with the person they belong to (NULL = the applicant /
--    application-level docs, exactly as today — fully backwards compatible).
ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS person_label text;

-- 2) UBO handoff sessions
CREATE TABLE IF NOT EXISTS public.kyc_ubo_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE CASCADE,
  person_name         text NOT NULL,              -- Step 1 full legal name (join key back to the card)
  person_email        text,
  client_company      text,                       -- shown on the UBO page header for context
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed','expired')),
  fields              jsonb,                      -- identity form answers keyed by data-field name
  selfie_doc_id       uuid,
  selfie_storage_path text,
  selfie_file_name    text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

CREATE INDEX IF NOT EXISTS idx_ubo_sessions_application
  ON public.kyc_ubo_sessions (application_id);

ALTER TABLE public.kyc_ubo_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.kyc_ubo_sessions TO anon;
GRANT ALL                    ON public.kyc_ubo_sessions TO authenticated;

-- anon policies — identical model to kyc_selfie_sessions / kyc_documents
DROP POLICY IF EXISTS anon_insert_ubo_sessions ON public.kyc_ubo_sessions;
CREATE POLICY anon_insert_ubo_sessions ON public.kyc_ubo_sessions
  FOR INSERT TO anon
  WITH CHECK (is_anon_accessible_application(application_id));

DROP POLICY IF EXISTS anon_select_ubo_sessions ON public.kyc_ubo_sessions;
CREATE POLICY anon_select_ubo_sessions ON public.kyc_ubo_sessions
  FOR SELECT TO anon
  USING (is_anon_accessible_application(application_id));

DROP POLICY IF EXISTS anon_update_ubo_sessions ON public.kyc_ubo_sessions;
CREATE POLICY anon_update_ubo_sessions ON public.kyc_ubo_sessions
  FOR UPDATE TO anon
  USING (is_anon_accessible_application(application_id))
  WITH CHECK (is_anon_accessible_application(application_id));

-- admin full access
DROP POLICY IF EXISTS admin_all_ubo_sessions ON public.kyc_ubo_sessions;
CREATE POLICY admin_all_ubo_sessions ON public.kyc_ubo_sessions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Verify:
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'public.kyc_ubo_sessions'::regclass;
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'kyc_documents' AND column_name = 'person_label';

-- HOTFIX 2026-07-19 late: the edge function (service role) got "permission
-- denied [42501]" — this project's default privileges don't auto-grant
-- service_role on new tables. Applied separately in prod the same night:
GRANT ALL ON public.kyc_ubo_sessions TO service_role;
GRANT ALL ON public.kyc_selfie_sessions TO service_role;
