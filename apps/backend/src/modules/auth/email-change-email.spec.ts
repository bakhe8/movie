import { describe, expect, it } from 'vitest';
import { emailChangeMail } from './email-change-email';

const LINK = 'https://kolme.app/account/confirm-email?token=abc123&x=1';

describe('emailChangeMail', () => {
  const mail = emailChangeMail(LINK, 30);

  it('says both languages in the subject, and never the token', () => {
    expect(mail.subject).toContain('تأكيد البريد الإلكتروني الجديد');
    expect(mail.subject).toContain('Confirm your new email');
    expect(mail.subject).not.toContain('abc123');
  });

  it('keeps the text part a whole message on its own', () => {
    expect(mail.text).toContain(LINK);
    expect(mail.text).toContain('صالح 30 دقيقة');
    expect(mail.text).toContain('valid for 30 minutes');
    expect(mail.text).toContain('تجاهل هذه الرسالة');
    expect(mail.text).toContain('ignore this message');
  });

  it('offers the link as a button and as text', () => {
    const escaped = LINK.replace(/&/g, '&amp;');
    expect(mail.html).toContain(`href="${escaped}"`);
    expect(mail.html.split(escaped)).toHaveLength(3);
  });

  it('escapes what it puts in the document', () => {
    const hostile = emailChangeMail('https://kolme.app/account/confirm-email?token=a"><script>x</script>', 30);

    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).toContain('&lt;script&gt;');
  });

  it('fetches nothing from anywhere', () => {
    expect(mail.html).not.toMatch(/<img/i);
    expect(mail.html).not.toMatch(/<link/i);
    expect(mail.html).not.toMatch(/@import/i);
    expect(mail.html).not.toMatch(/https?:\/\/(?!kolme\.app)/i);
  });
});
