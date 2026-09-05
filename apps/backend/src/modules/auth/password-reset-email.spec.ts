import { describe, expect, it } from 'vitest';
import { passwordResetMail } from './password-reset-email';

// The message used to be one paragraph with a long token URL in the middle of
// it, which is what phishing looks like (owner decision 2026-09-05). What the
// template must keep is checked here, not the styling.
const LINK = 'https://kolme.app/reset-password?token=abc123&x=1';

describe('passwordResetMail', () => {
  const mail = passwordResetMail(LINK, 30);

  it('says both languages in the subject, and never the token', () => {
    expect(mail.subject).toContain('إعادة تعيين كلمة المرور');
    expect(mail.subject).toContain('Reset your password');
    expect(mail.subject).not.toContain('abc123');
  });

  it('keeps the text part a whole message on its own', () => {
    expect(mail.text).toContain(LINK);
    expect(mail.text).toContain('صالح 30 دقيقة');
    expect(mail.text).toContain('valid for 30 minutes');
    // The "you did not ask for this" line is what makes an unexpected mail safe.
    expect(mail.text).toContain('تجاهل هذه الرسالة');
    expect(mail.text).toContain('ignore this message');
  });

  it('offers the link as a button and as text, since one of the two always works', () => {
    const escaped = LINK.replace(/&/g, '&amp;');
    expect(mail.html).toContain(`href="${escaped}"`);
    // Once in the href, once visible underneath.
    expect(mail.html.split(escaped)).toHaveLength(3);
  });

  it('escapes what it puts in the document, so a link can never carry markup', () => {
    const hostile = passwordResetMail('https://kolme.app/reset-password?token=a"><script>x</script>', 30);

    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
  });

  it('fetches nothing from anywhere: no images, no remote styles, no fonts', () => {
    expect(mail.html).not.toMatch(/<img/i);
    expect(mail.html).not.toMatch(/<link/i);
    expect(mail.html).not.toMatch(/@import/i);
    expect(mail.html).not.toMatch(/https?:\/\/(?!kolme\.app)/i);
  });

  it('carries the name and the accent of the product it comes from', () => {
    expect(mail.html).toContain('Kolme');
    expect(mail.html).toContain('#5b4bd6');
  });

  it('states the same expiry it was given, in both languages', () => {
    const short = passwordResetMail(LINK, 15);

    expect(short.html).toContain('صالح 15 دقيقة');
    expect(short.html).toContain('valid for 15 minutes');
  });
});
