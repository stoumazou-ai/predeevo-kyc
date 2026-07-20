// ════════════════════════════════════════════════════════════════════════
// Predeevo — Edge Function: kyc-invitation-email
// ════════════════════════════════════════════════════════════════════════
// Sends the initial KYC invitation email to a client.
// Called from the AMLCO dashboard when "Create + Send email" is clicked.
// Updates kyc_invitations.sent_at to track delivery.
// 2026-07-20: added the "please have ready before you start" checklist.
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
    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return new Response(JSON.stringify({ error: "invitation_id required" }), {
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

    // Fetch the invitation
    const { data: inv, error: invErr } = await sb
      .from("kyc_invitations")
      .select("token, client_name, client_email, client_company, services, entity_type, expires_at, sent_at")
      .eq("id", invitation_id)
      .single();

    if (invErr || !inv) {
      console.error("Invitation lookup failed:", invErr);
      return new Response(JSON.stringify({ error: "invitation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!inv.client_email || !inv.token) {
      return new Response(
        JSON.stringify({ error: "invitation missing email or token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const inviteUrl = `${KYC_BASE_URL}/?token=${inv.token}`;
    const expiresAt = new Date(inv.expires_at);
    const expiresDateStr = expiresAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const firstName = (inv.client_name || "").split(" ")[0] || "there";

    // Service labels for the email body — mapped to display strings
    const serviceLabels: Record<string, string> = {
      incorp:       "Company incorporation",
      accounting:   "Accounting & bookkeeping",
      tax:          "Tax advisory & compliance",
      payroll:      "Payroll services",
      audit:        "Audit & assurance",
      admin:        "Company administration",
      director:     "Director / nominee",
      trust:        "Trust & foundation",
      regoffice:    "Registered office",
      other:        "Other services",
    };
    const servicesList = (inv.services || []).map(s => serviceLabels[s] || s);
    const servicesHtml = servicesList.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:#555;line-height:1.7">${servicesList.map(s => `<li>${s}</li>`).join("")}</ul>`
      : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Your KYC verification — Predeevo</title></head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f6fa">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)">
      <tr><td style="background:#1C75BC;padding:24px 32px;text-align:left">
        <img src="${LOGO_URL}" alt="Predeevo" width="160" style="display:block;border:0;outline:none">
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#1a1a1a">Your KYC verification</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">Hi ${firstName},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">Welcome to Predeevo. To begin our engagement, we need to complete your Know Your Client verification — a regulatory requirement under Cyprus AML Law 188(I)/2007 and ICPAC's risk-based approach.</p>
        ${servicesHtml ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#666"><strong>Services to be engaged:</strong></p>${servicesHtml}<div style="margin-bottom:16px"></div>` : ""}
        <div style="background:#fef8ec;border:1px solid #f0d9a8;border-radius:8px;padding:14px 16px;margin:0 0 16px">
          <p style="margin:0 0 6px;font-size:13px;line-height:1.55;color:#8a6210"><strong>Please have ready before you start:</strong></p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#8a6210;line-height:1.7">
            <li>Your passport or national ID card — a clear scan or photo</li>
            <li>A proof of address — utility bill or bank statement from the last 6 months</li>
            <li>Your CV, plus personal details (tax number, occupation, income)</li>
            <li>A device with a camera for a quick identity selfie — your phone works best</li>
          </ul>
        </div>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444">The form takes approximately 10–15 minutes to complete. You can save your progress and return any time.</p>
        <div style="margin:28px 0">
          <a href="${inviteUrl}" style="display:inline-block;background:#1C75BC;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:600">Begin your KYC</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#666"><strong>Or copy this link:</strong></p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.55;color:#1C75BC;word-break:break-all">${inviteUrl}</p>
        <div style="background:#eaf3fb;border-radius:8px;padding:14px 16px;margin:0 0 16px">
          <p style="margin:0;font-size:13px;line-height:1.55;color:#155a93"><strong>Important:</strong> This link is unique to you and will remain accessible until <strong>${expiresDateStr}</strong>. All information is encrypted and processed in strict confidence under Cyprus AML law.</p>
        </div>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.55;color:#666">If you have any questions or need help completing the form, please reply to this email or contact your Predeevo advisor.</p>
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
        to: [inv.client_email],
        subject: `Your Predeevo KYC verification — ${inv.client_company || inv.client_name}`,
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

    // Mark sent_at — status stays 'pending' until client actually opens or completes the form.
    // sent_at tracks delivery; status tracks lifecycle. Two separate concepts.
    const { error: updErr } = await sb
      .from("kyc_invitations")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", invitation_id);

    if (updErr) {
      console.warn("Could not mark invitation as sent (email was sent successfully):", updErr);
    }

    return new Response(
      JSON.stringify({ ok: true, sent_to: inv.client_email }),
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
