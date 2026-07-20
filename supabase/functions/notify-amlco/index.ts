// ════════════════════════════════════════════════════════════════════════
// Predeevo — Edge Function: notify-amlco  (rewritten 2026-07-20)
// ════════════════════════════════════════════════════════════════════════
// Triggered by a database trigger/webhook on kyc_applications.
// Emails the AMLCO when an application is genuinely SUBMITTED.
//
// Fixes vs the original:
//  - Only fires on a real submission (status='submitted', and not an already-
//    submitted row being updated again) — the original fired on row INSERT,
//    which happens at the FIRST DRAFT SAVE, so it notified about drafts and
//    stayed silent on actual submissions.
//  - Applicant name/email come from kyc_shareholders (is_applicant row) via
//    service role — the original read first_name/surname/email/pep_status off
//    the applications row, where those columns don't exist (always blank).
//  - Content per AMLCO spec: Reference, Submission date, Applicant, Email,
//    Company. Review link points at the compliance dashboard.
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AMLCO_EMAIL = "stoumazou@predeevo.com";
const FROM_EMAIL = "Predeevo KYC <noreply@predeevo.com>";
const DASHBOARD_URL = "https://app.predeevo.com";

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;
    const oldRecord = payload.old_record;

    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    // Notify ONLY on the transition into 'submitted'. Draft inserts/saves and
    // post-submission updates (status changes by the AMLCO etc.) are skipped.
    if (record.status !== "submitted") {
      return new Response(JSON.stringify({ skipped: "not a submission (status=" + record.status + ")" }), { status: 200 });
    }
    if (oldRecord && oldRecord.status === "submitted") {
      return new Response(JSON.stringify({ skipped: "already submitted before this update" }), { status: 200 });
    }

    // Applicant identity lives in kyc_shareholders, not on the application row
    let applicantName = "—";
    let applicantEmail = "—";
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      });
      const { data: ap, error } = await sb
        .from("kyc_shareholders")
        .select("full_name, first_name, surname, email")
        .eq("application_id", record.id)
        .eq("is_applicant", true)
        .limit(1)
        .maybeSingle();
      if (error) console.error("Applicant lookup failed:", error);
      if (ap) {
        applicantName = ap.full_name || [ap.first_name, ap.surname].filter(Boolean).join(" ") || "—";
        applicantEmail = ap.email || "—";
      }
    } catch (e) {
      console.error("Applicant lookup exception:", e);
    }

    const companyName = record.company_name || record.entity_name || "—";
    const submittedAt = record.submitted_at
      ? new Date(record.submitted_at).toLocaleString("en-GB", { timeZone: "Europe/Nicosia" })
      : new Date().toLocaleString("en-GB", { timeZone: "Europe/Nicosia" });
    const subject = `New KYC Submission · ${record.reference}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
        <div style="background: #1C75BC; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 600;">New KYC Submission</h1>
          <p style="margin: 4px 0 0; opacity: 0.85; font-size: 13px;">Predeevo Ltd · Compliance Alert</p>
        </div>
        <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; font-weight: 600; color: #6b7280; width: 140px;">Reference</td><td style="padding: 8px 0; font-family: monospace; font-size: 14px;">${record.reference}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Submitted</td><td style="padding: 8px 0;">${submittedAt}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Applicant</td><td style="padding: 8px 0;">${applicantName}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Email</td><td style="padding: 8px 0;">${applicantEmail}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Company</td><td style="padding: 8px 0;">${companyName}</td></tr>
          </table>

          <div style="margin-top: 24px; padding: 16px; background: white; border-left: 4px solid #1C75BC; border-radius: 4px;">
            <p style="margin: 0; font-size: 13px; color: #4b5563;">
              <strong>Action required:</strong> Please review this submission in the Predeevo compliance dashboard and complete the CDD assessment within the regulatory timeframe.
            </p>
          </div>

          <div style="margin-top: 24px; text-align: center;">
            <a href="${DASHBOARD_URL}" style="display: inline-block; background: #1C75BC; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Open compliance dashboard →</a>
          </div>

          <p style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center;">
            Predeevo Ltd · Sintika Hanum 58, 6051 Larnaca, Cyprus<br>
            This is an automated notification from the Predeevo KYC platform
          </p>
        </div>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [AMLCO_EMAIL],
        subject: subject,
        html: html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend error:", data);
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
