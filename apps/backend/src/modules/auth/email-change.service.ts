import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { EmailChange } from '../../entities/email-change.entity';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { MailOutboxService } from '../mail/mail-outbox.service';
import { emailChangeMail } from './email-change-email';
import { captureException } from '../../observability/observability';

export function hashEmailChangeToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const DEFAULT_TTL_MINUTES = 30;

// Account settings: change email (owner-approved design 2026-09-06). Mirrors
// PasswordResetService's shape exactly -- same token discipline, same mail
// outbox durability -- but the effect at confirm time is different: it moves
// `users.email`, and the link is mailed to the address being claimed, not
// the account's current one, so confirming it *is* proving that mailbox.
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);
  private readonly ttlMs: number;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EmailChange)
    private readonly changesRepository: Repository<EmailChange>,
    private readonly outbox: MailOutboxService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const minutes = Number(config.get<string>('EMAIL_CHANGE_TTL_MINUTES') ?? DEFAULT_TTL_MINUTES);
    this.ttlMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60_000;
    this.appUrl = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  // Requires the current password (same discipline as /privacy/export and
  // /privacy/delete): a bare access token must not be enough to move an
  // account to an address its owner never typed a password to prove.
  async request(userId: string, newEmail: string, currentPassword: string, ip: string | null): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException('User not found');
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      throw new UnauthorizedException('Incorrect password');
    }

    if (newEmail === user.email) {
      throw new ConflictException('This is already your email address');
    }

    const existing = await this.usersRepository.findOne({ where: { email: newEmail } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // One live link at a time, same as password-reset: a second request
    // revokes the first, so a stale link never confirms a superseded change.
    await this.changesRepository.update(
      { userId: user.id, usedAt: IsNull(), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    const raw = randomBytes(32).toString('base64url');
    const change = await this.changesRepository.save(
      this.changesRepository.create({
        userId: user.id,
        newEmail,
        tokenHash: hashEmailChangeToken(raw),
        expiresAt: new Date(Date.now() + this.ttlMs),
      }),
    );

    const link = `${this.appUrl}/account/confirm-email?token=${raw}`;
    let outcome: 'delivered' | 'queued' | 'failed' = 'failed';
    try {
      const message = emailChangeMail(link, Math.round(this.ttlMs / 60_000));
      const queued = await this.outbox.enqueue({
        userId: user.id,
        kind: 'email_change',
        to: newEmail,
        subject: message.subject,
        text: message.text,
        html: message.html,
        expiresAt: change.expiresAt,
      });
      outcome = queued.status === 'delivered' ? 'delivered' : queued.status === 'pending' ? 'queued' : 'failed';
    } catch (error) {
      this.logger.error(
        `email-change mail could not be queued for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      captureException(error, { job: 'email-change-mail' });
    }
    if (outcome === 'failed') {
      await this.changesRepository.update({ id: change.id }, { revokedAt: new Date() });
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.email_change.requested',
      resource: 'user',
      resourceId: user.id,
      status: outcome === 'delivered' ? 'ok' : outcome === 'queued' ? 'scheduled' : 'failed',
      reason: outcome === 'delivered' ? null : outcome === 'queued' ? 'mail_queued_for_retry' : 'mail_send_failed',
      ip,
    });

    if (outcome === 'failed') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Could not send the confirmation email',
        error: 'Bad Request',
        reason: 'email_change_mail_failed',
      });
    }
  }

  // Spends the token and moves the account's email. No session is ended --
  // unlike a password reset, an email change does not answer a fear that the
  // account itself was compromised, so signing every device out would only
  // be friction.
  async confirm(rawToken: string, ip: string | null): Promise<{ email: string }> {
    const change = await this.changesRepository.findOne({ where: { tokenHash: hashEmailChangeToken(rawToken) } });
    const now = new Date();
    if (!change || change.usedAt || change.revokedAt || change.expiresAt <= now) {
      await this.audit.record({
        actorUserId: change?.userId ?? null,
        action: 'auth.email_change.confirmed',
        resource: 'user',
        resourceId: change?.userId ?? null,
        status: 'failed',
        reason: !change ? 'unknown token' : change.usedAt ? 'already used' : change.revokedAt ? 'revoked' : 'expired',
        ip,
      });
      throw new BadRequestException({
        statusCode: 400,
        message: 'This confirmation link is no longer valid',
        error: 'Bad Request',
        reason: 'email_change_token_invalid',
      });
    }

    const user = await this.usersRepository.findOne({ where: { id: change.userId } });
    if (!user || !user.active) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'This confirmation link is no longer valid',
        error: 'Bad Request',
        reason: 'email_change_token_invalid',
      });
    }

    try {
      await this.usersRepository.update({ id: user.id }, { email: change.newEmail });
    } catch (error) {
      // The address could have been claimed by another account between the
      // request and this confirm (M3-style race); map the same way register
      // and password-reset already do instead of a raw 500.
      if (this.isUniqueConstraintError(error)) {
        await this.audit.record({
          actorUserId: user.id,
          action: 'auth.email_change.confirmed',
          resource: 'user',
          resourceId: user.id,
          status: 'failed',
          reason: 'email taken since request',
          ip,
        });
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
    await this.changesRepository.update({ id: change.id }, { usedAt: now });
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.email_change.confirmed',
      resource: 'user',
      resourceId: user.id,
      status: 'ok',
      reason: null,
      ip,
    });
    return { email: change.newEmail };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
