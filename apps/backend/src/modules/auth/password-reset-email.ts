// The password-reset message, in Kolme's own clothes (owner decision
// 2026-09-05; visual direction ADR-111). It was a raw paragraph with a long
// token URL in the middle of it, which reads like the phishing it is not.
//
// Rules this file keeps:
// - Both languages in one message, Arabic first, each in its own direction:
//   the account has no language field, so the mail cannot pick one.
// - No images, no web fonts, no remote anything: a mail client that blocks
//   remote content must lose nothing, and nothing here may phone home.
// - Table layout with inline styles, since mail clients support little else;
//   the palette is the light theme's tokens (styles/tokens.css), written out
//   because a mail cannot read a stylesheet.
// - The link appears twice: on the button and as text under it, because a
//   button is unreachable in a plain-text client and unclickable in some.
// - The text part stays the whole message on its own.

const ACCENT = '#5b4bd6';
const INK = '#ffffff';
const GROUND = '#f4f4fa';
const SURFACE = '#ffffff';
const TEXT = '#171a33';
const MUTED = '#5e6285';
const LINE = '#d4d5e8';
const FONT = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";

export interface PasswordResetMail {
  subject: string;
  text: string;
  html: string;
}

// A link goes into an href and into visible text; both are attacker-reachable
// only through our own token, but the address the link is built from comes
// from configuration, so it is escaped like anything else that is not ours.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Three bars: the mark app/components/BrandMark.tsx draws, in table cells,
// because SVG is stripped by several mail clients and an image would be a
// remote fetch.
function mark(): string {
  const bar = (height: number) =>
    `<td style="width:6px;height:${height}px;background:${ACCENT};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>`;
  const gap = '<td style="width:4px;font-size:0;line-height:0">&nbsp;</td>';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>${bar(12)}${gap}${bar(18)}${gap}${bar(12)}</tr></table>`;
}

export function passwordResetMail(link: string, ttlMinutes: number): PasswordResetMail {
  const href = escapeHtml(link);
  const minutes = String(ttlMinutes);

  const subject = 'إعادة تعيين كلمة المرور · Reset your password';

  const text = [
    `افتح الرابط لتعيين كلمة مرور جديدة (صالح ${minutes} دقيقة):`,
    link,
    'إن لم تطلب هذا، تجاهل هذه الرسالة ولن يتغيّر شيء.',
    '',
    `Open this link to set a new password (valid for ${minutes} minutes):`,
    link,
    'If you did not ask for this, ignore this message and nothing changes.',
  ].join('\n');

  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td style="border-radius:8px;background:${ACCENT}"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;color:${INK};text-decoration:none;border-radius:8px">تعيين كلمة مرور جديدة · Set a new password</a></td></tr></table>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kolme</title></head>
<body style="margin:0;padding:0;background:${GROUND}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${GROUND};padding:24px 12px">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="max-width:480px;width:100%;background:${SURFACE};border:1px solid ${LINE};border-radius:8px">
  <tr><td style="padding:20px 24px 0 24px" align="right">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-inline-end:8px;padding-left:8px">${mark()}</td>
      <td style="font-family:${FONT};font-size:20px;font-weight:600;color:${TEXT}">Kolme</td>
    </tr></table>
  </td></tr>

  <tr><td dir="rtl" align="right" style="padding:20px 24px 0 24px;font-family:${FONT};color:${TEXT}">
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:600">إعادة تعيين كلمة المرور</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED}">اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح ${minutes} دقيقة ولمرة واحدة.</p>
  </td></tr>

  <tr><td style="padding:20px 24px">${button}</td></tr>

  <tr><td dir="ltr" align="left" style="padding:0 24px 20px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all">
    ${href}
  </td></tr>

  <tr><td style="padding:0 24px"><div style="height:1px;background:${LINE};font-size:0;line-height:0">&nbsp;</div></td></tr>

  <tr><td dir="ltr" align="left" style="padding:20px 24px 0 24px;font-family:${FONT};color:${TEXT}">
    <h2 style="margin:0 0 8px 0;font-size:18px;font-weight:600">Reset your password</h2>
    <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED}">Use the button above to set a new password. The link is valid for ${minutes} minutes and works once.</p>
  </td></tr>

  <tr><td style="padding:20px 24px 24px 24px;font-family:${FONT};font-size:13px;line-height:1.7;color:${MUTED}">
    <div dir="rtl" align="right">إن لم تطلب هذا، تجاهل الرسالة ولن يتغيّر شيء.</div>
    <div dir="ltr" align="left">If you did not ask for this, ignore this message and nothing changes.</div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
