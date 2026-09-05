import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { PasswordReset } from '../../entities/password-reset.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { MailOutboxService } from '../mail/mail-outbox.service';
import { passwordResetMail } from './password-reset-email';
import { captureException } from '../../observability/observability';

export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const DEFAULT_TTL_MINUTES = 30;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMs: number;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(PasswordReset)
    private readonly resetsRepository: Repository<PasswordReset>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    private readonly outbox: MailOutboxService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const minutes = Number(config.get<string>('PASSWORD_RESET_TTL_MINUTES') ?? DEFAULT_TTL_MINUTES);
    this.ttlMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60_000;
    this.appUrl = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  // Always resolves the same way, whether or not the address has an account:
  // answering differently would turn this route into a membership oracle
  // (BP §21.3). The work still happens for a real account, and nothing
  // observable distinguishes the two from outside.
  async request(email: string, ip: string | null): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user || !user.active) {
      // Audited so an operator can still see reset attempts for addresses
      // that have no account -- the signal a scan would produce.
      await this.audit.record({
        actorUserId: null,
        action: 'auth.password_reset.requested',
        resource: 'user',
        resourceId: null,
        status: 'failed',
        reason: user ? 'no_reset_sent: inactive account' : 'no_reset_sent: no account',
        ip,
      });
      return;
    }

    // One live link at a time: a second request revokes the first, so a
    // forwarded or logged older mail stops working immediately.
    await this.resetsRepository.update({ userId: user.id, usedAt: IsNull(), revokedAt: IsNull() }, { revokedAt: new Date() });

    const raw = randomBytes(32).toString('base64url');
    const reset = await this.resetsRepository.save(
      this.resetsRepository.create({
        userId: user.id,
        tokenHash: hashResetToken(raw),
        expiresAt: new Date(Date.now() + this.ttlMs),
        ipHash: ip ? createHash('sha256').update(ip).digest('hex') : null,
      }),
    );

    const link = `${this.appUrl}/reset-password?token=${raw}`;
    // The message is a mail_outbox row first (ADR-97): a provider failure is
    // retried with backoff until the link expires, so a blip at the provider
    // costs a delay, not the request. Nothing here may answer differently
    // for a real address than for an unknown one -- the membership oracle
    // this route exists not to be (AUDIT_2026-09-05 H1) -- so a failure to
    // even queue resolves like a success from outside. A row that is dead
    // on its first attempt (nobody will ever receive it) revokes the token,
    // and both cases are logged and audited so an operator can see the
    // request went nowhere instead of finding an orphaned live row.
    let outcome: 'delivered' | 'queued' | 'failed' = 'failed';
    try {
      // One place composes the message (password-reset-email.ts): the same
      // link on a button and as text, in both languages, in Kolme's colours.
      const message = passwordResetMail(link, Math.round(this.ttlMs / 60_000));
      const queued = await this.outbox.enqueue({
        userId: user.id,
        kind: 'password_reset',
        to: user.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        expiresAt: reset.expiresAt,
      });
      outcome = queued.status === 'delivered' ? 'delivered' : queued.status === 'pending' ? 'queued' : 'failed';
    } catch (error) {
      // User id only: never the address, the link or the token.
      this.logger.error(
        `password-reset mail could not be queued for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      captureException(error, { job: 'password-reset-mail' });
    }
    if (outcome === 'failed') {
      await this.resetsRepository.update({ id: reset.id }, { revokedAt: new Date() });
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_reset.requested',
      resource: 'user',
      resourceId: user.id,
      status: outcome === 'delivered' ? 'ok' : outcome === 'queued' ? 'scheduled' : 'failed',
      reason: outcome === 'delivered' ? null : outcome === 'queued' ? 'mail_queued_for_retry' : 'mail_send_failed',
      ip,
    });
  }

  // Spending a token sets the password and ends every existing session: a
  // reset is what someone does when they fear their account is not theirs
  // alone, so leaving old refresh tokens alive would defeat it.
  async confirm(rawToken: string, newPassword: string, ip: string | null): Promise<void> {
    const reset = await this.resetsRepository.findOne({ where: { tokenHash: hashResetToken(rawToken) } });
    const now = new Date();
    if (!reset || reset.usedAt || reset.revokedAt || reset.expiresAt <= now) {
      await this.audit.record({
        actorUserId: reset?.userId ?? null,
        action: 'auth.password_reset.confirmed',
        resource: 'user',
        resourceId: reset?.userId ?? null,
        status: 'failed',
        reason: !reset ? 'unknown token' : reset.usedAt ? 'already used' : reset.revokedAt ? 'revoked' : 'expired',
        ip,
      });
      throw new BadRequestException({
        statusCode: 400,
        message: 'This reset link is no longer valid',
        error: 'Bad Request',
        reason: 'reset_token_invalid',
      });
    }

    const user = await this.usersRepository.findOne({ where: { id: reset.userId } });
    if (!user || !user.active) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'This reset link is no longer valid',
        error: 'Bad Request',
        reason: 'reset_token_invalid',
      });
    }

    await this.usersRepository.update({ id: user.id }, { password: await bcrypt.hash(newPassword, 10) });
    await this.resetsRepository.update({ id: reset.id }, { usedAt: now });
    await this.refreshTokensRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: now, revokedReason: 'password_reset' },
    );
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_reset.confirmed',
      resource: 'user',
      resourceId: user.id,
      status: 'ok',
      reason: null,
      ip,
    });
  }

  // Expired rows carry no secret (only a hash) but no reason to keep either.
  async purgeExpired(before: Date = new Date()): Promise<number> {
    const result = await this.resetsRepository.delete({ expiresAt: LessThan(before) });
    return result.affected ?? 0;
  }
}
