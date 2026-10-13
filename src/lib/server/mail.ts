import nodemailer from "nodemailer";
import { APP_NAME } from "@/lib/constants";

function envValue(names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(process.env)) {
    if (!wanted.has(key.toLowerCase())) continue;
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function systemMail() {
  let address = envValue(["SMTP_USER", "SMPT_USER", "SMTP_EMAIL", "GMAIL_USER"]).toLowerCase();
  let password = envValue(["SMTP_PASS", "SMPT_PASS", "SMTP_PASSWORD", "GMAIL_APP_PASSWORD"]);
  if ((address.startsWith('"') && address.endsWith('"')) || (address.startsWith("'") && address.endsWith("'"))) {
    address = address.slice(1, -1).trim().toLowerCase();
  }
  if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) {
    password = password.slice(1, -1).trim();
  }
  password = password.replace(/\s+/g, "");
  if (!address || !password) return { error: "Invite email isn't set up yet. Add SMTP_USER and SMTP_PASS in Secrets, save, then publish." as const };
  if (!address.includes("@")) return { error: "SMTP_USER must be the full Gmail address" as const };
  if (password.length !== 16) {
    return { error: "SMTP_PASS must be the 16-character app password, not your normal Gmail password" as const };
  }
  return { address, password };
}

function transport(address: string, password: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: address, pass: password },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
  });
}

function esc(value: string) {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;");
}

function letter(input: { eyebrow: string; title: string; body: string; action: string; url: string; note: string }) {
  const href = esc(input.url);
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0c0c0d;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0c0d;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
          <tr>
            <td style="padding:0 8px 18px;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:-0.03em;color:#f4f1ea;">Kharcha</td>
          </tr>
          <tr>
            <td style="background:#161618;border-radius:24px;padding:32px 28px;">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#9a958c;">${esc(input.eyebrow)}</p>
              <h1 style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.1;font-weight:500;letter-spacing:-0.03em;color:#f7f4ee;">${esc(input.title)}</h1>
              <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.55;color:#c8c2b8;">${esc(input.body)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                <tr>
                  <td style="border-radius:999px;background:#f4f1ea;">
                    <a href="${href}" style="display:inline-block;padding:14px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#141414;text-decoration:none;">${esc(input.action)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;color:#8d877e;">${esc(input.note)}</p>
              <p style="margin:14px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${href}" style="color:#d7d1c7;text-decoration:underline;">${href}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.5;color:#6f6a63;">Personal money stays personal. This link only opens what you were invited to.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function inviteMessage(fromName: string, familyName: string, url: string) {
  const who = fromName.trim() || "Someone";
  const family = familyName.trim() || "your family";
  const subject = `${who} invited you to ${family}`;
  const text = `${who} invited you to ${family} on ${APP_NAME}.\n\nOpen the link to join. If you're new, sign in and finish the short setup. The family will use the name on your account.\n\n${url}\n`;
  const html = letter({
    eyebrow: "Family invite",
    title: family,
    body: `${who} invited you to keep this family's money together on Kharcha.`,
    action: "Join the family",
    url,
    note: "If you're new, the link signs you in and a short setup comes first. Then you land in the family.",
  });
  return { subject, text, html };
}

export function splitMessage(fromName: string, description: string, share: string, url: string) {
  const who = fromName.trim() || "Someone";
  const what = description.trim() || "a bill";
  const amount = share.trim() || "your share";
  const subject = `${who} split ${what} with you`;
  const text = `${who} split ${what} with you. Your share is ${amount}.\n\n${url}\n`;
  const html = letter({
    eyebrow: "Split",
    title: amount,
    body: `${who} split ${what} with you. This is only your share.`,
    action: "Open the split",
    url,
    note: "The link shows this expense. It does not open anyone else's books.",
  });
  return { subject, text, html };
}

export async function sendInviteSmtp(
  to: string,
  fromName: string,
  familyName: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!url.startsWith("http")) return { ok: false, error: "Invite link isn't ready" };
  const mail = systemMail();
  if ("error" in mail) return { ok: false, error: mail.error };
  const message = inviteMessage(fromName, familyName, url);
  try {
    await transport(mail.address, mail.password).sendMail({
      from: `"${APP_NAME}" <${mail.address}>`,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true };
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "";
    if (/535|534|BadCredentials|Invalid login|Username and Password not accepted/i.test(messageText)) {
      return { ok: false, error: "Gmail refused that login. SMTP_PASS has to be a new app password for the same Gmail as SMTP_USER." };
    }
    return { ok: false, error: "Invite email didn't send." };
  }
}
