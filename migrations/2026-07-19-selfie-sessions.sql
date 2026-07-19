-- ============================================================================
-- Mobile-link selfie handoff — session table + RLS
-- Run in Supabase SQL editor. Idempotent-ish (uses IF NOT EXISTS / DROP POLICY).
-- ============================================================================
-- Purpose: let a client capture their identity selfie on their phone while
-- filling the KYC form on desktop. The desktop creates a short-lived session
-- row, encodes its id into a QR code, and polls for status='captured'. The
-- phone (anon, no invitation token) reads the session to learn the
-- application_id, then uploads the selfie through the EXISTING anon storage +
-- kyc_documents policies (both gated on is_anon_accessible_application), and
-- flips the session to 'captured'. No changes to storage/document RLS needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kyc_selfie_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','captured','expired')),
  client_name         text,                       -- denormalised label shown on the phone
  selfie_doc_id       uuid,                       -- kyc_documents.id written by the phone
  selfie_storage_path text,
  selfie_file_name    text,
  captured_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_selfie_sessions_application
  ON public.kyc_selfie_sessions (application_id);

ALTER TABLE public.kyc_selfie_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase auto-grants table privileges to anon/authenticated on new public
-- tables, but be explicit so RLS is the only thing gating access.
GRANT SELECT, INSERT, UPDATE ON public.kyc_selfie_sessions TO anon;
GRANT ALL                    ON public.kyc_selfie_sessions TO authenticated;

-- ── anon policies — mirror the existing kyc_documents model exactly ──
-- A session is usable only while its application's invitation is still valid
-- (pending + not expired). is_anon_accessible_application() enforces that; the
-- session id itself is an unguessable UUID, same secrecy model as the app id.

DROP POLICY IF EXISTS anon_insert_selfie_sessions ON public.kyc_selfie_sessions;
CREATE POLICY anon_insert_selfie_sessions ON public.kyc_selfie_sessions
  FOR INSERT TO anon
  WITH CHECK (is_anon_accessible_application(application_id));

DROP POLICY IF EXISTS anon_select_selfie_sessions ON public.kyc_selfie_sessions;
CREATE POLICY anon_select_selfie_sessions ON public.kyc_selfie_sessions
  FOR SELECT TO anon
  USING (is_anon_accessible_application(application_id));

DROP POLICY IF EXISTS anon_update_selfie_sessions ON public.kyc_selfie_sessions;
CREATE POLICY anon_update_selfie_sessions ON public.kyc_selfie_sessions
  FOR UPDATE TO anon
  USING (is_anon_accessible_application(application_id))
  WITH CHECK (is_anon_accessible_application(application_id));

-- ── admin full access (dashboard / manual cleanup) ──
DROP POLICY IF EXISTS admin_all_selfie_sessions ON public.kyc_selfie_sessions;
CREATE POLICY admin_all_selfie_sessions ON public.kyc_selfie_sessions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Verify:
--   SELECT polname, polcmd FROM pg_policy
--   WHERE polrelid = 'public.kyc_selfie_sessions'::regclass;
