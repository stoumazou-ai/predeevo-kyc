// ════════════════════════════════════════════════════════════════════════
// Predeevo — Edge Function: kyc-ubo-invitation-email
// ════════════════════════════════════════════════════════════════════════
// Emails a UBO their personal self-service KYC link (ubo.html?u=<session>).
// Called from the client-facing KYC form when the applicant clicks
// "Send KYC link" on a co-UBO's Step 2 card (after the kyc_ubo_sessions row
// is created). Mirrors kyc-invitation-email: same Resend account, same
// from-address, same visual template.
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FROM_EMAIL = "Predeevo <noreply@predeevo.com>";
const KYC_BASE_URL = "https://kyc.predeevo.com";
const LOGO_URL = "https://predeevo.com/wp-content/uploads/2026/05/predeevo_cont_white_472.png";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "server misconfigured (missing service role key)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
    });

    // Fetch the UBO session
    const { data: sess, error: sessErr } = await sb
      .from("kyc_ubo_sessions")
      .select("id, person_name, person_email, client_company, status, expires_at")
      .eq("id", session_id)
      .single();

    if (sessErr || !sess) {
      console.error("UBO session lookup failed:", sessErr);
      // Diagnostic detail: distinguishes a genuinely missing row from a failing
      // service-role query (bad key, schema issue, etc.)
      const detail = sessErr
        ? `${sessErr.message}${sessErr.code ? " [" + sessErr.code + "]" : ""}`
        : "query ok but no row returned";
      return new Response(JSON.stringify({ error: "session not found", detail }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sess.person_email) {
      return new Response(
        JSON.stringify({ error: "session has no email on file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (sess.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "session is no longer pending" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uboUrl = `${KYC_BASE_URL}/ubo.html?u=${sess.id}`;
    const expiresAt = new Date(sess.expires_at);
    const expiresDateStr = expiresAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const firstName = (sess.person_name || "").split(" ")[0] || "there";
    const companyLine = sess.client_company
      ? ` in connection with <strong>${sess.client_company}</strong>`
      : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Identity verification required — Predeevo</title></head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f6fa">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)">
      <tr><td style="background:#1C75BC;padding:24px 32px;text-align:left">
        <img src="${LOGO_URL}" alt="Predeevo" width="160" style="display:block;border:0;outline:none">
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#1a1a1a">Identity verification required</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">You have been named as a beneficial owner${companyLine} in a client onboarding with Predeevo. Under Cyprus AML Law 188(I)/2007 we are required to verify the identity of every beneficial owner personally.</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#444">Using your personal secure link below, you will:</p>
        <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:#555;line-height:1.8">
          <li>Confirm your identity details (as on your passport or ID card)</li>
          <li>Upload your passport or ID card, a proof of address, and your CV</li>
          <li>Take a quick selfie with your device's camera</li>
        </ul>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">It takes about 10 minutes. Please have your documents to hand and use a device with a camera (your phone works best).</p>
        <div style="margin:28px 0">
          <a href="${uboUrl}" style="display:inline-block;background:#1C75BC;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600">Verify my identity</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#666"><strong>Or copy this link:</strong></p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.55;color:#1C75BC;word-break:break-all">${uboUrl}</p>
        <div style="background:#eaf3fb;border-radius:8px;padding:14px 16px;margin:0 0 16px">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#155a93"><strong>Important:</strong> This link is personal to you and will remain accessible until <strong>${expiresDateStr}</strong>. All information is encrypted and processed in strict confidence under Cyprus AML law.</p>
        </div>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.55;color:#666">If you were not expecting this request or have any questions, please reply to this email or contact compliance@predeevo.com.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e5e7eb">
        <p style="margin:0;font-size:11px;line-height:1.55;color:#888;text-align:center">Predeevo Limited &middot; Sintika Hanum 58, 6051 Larnaca, Cyprus &middot; +357 24255858 &middot; <a href="https://www.predeevo.com" style="color:#888;text-decoration:none">www.predeevo.com</a></p>
        <p style="margin:8px 0 0;font-size:10px;line-height:1.55;color:#aaa;text-align:center">AML/CFT operations &middot; ICPAC-regulated</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [sess.person_email],
        subject: `Identity verification required — ${sess.client_company || "Predeevo KYC"}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend failed:", errText);
      return new Response(
        JSON.stringify({ error: "email send failed", details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sent_to: sess.person_email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
