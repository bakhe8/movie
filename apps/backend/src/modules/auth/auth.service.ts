import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsNull, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
// bcryptjs, not bcrypt: same hash/compare API, but pure JS -- no native
// compile step via node-pre-gyp/tar, which is what pulled a critical
// path-traversal advisory into `npm audit` (tar <=7.5.20, GHSA-34x7-hfp2-rc4v
// and related).
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getRefreshTokenTtlDays } from '../../config/jwt.config';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { isCanaryEmail } from './canary-account';

// What JwtStrategy.validate() puts on req.user for every guarded route --
// the password hash must never travel with it (see validateUser below).
export type SafeUser = Omit<User, 'password'>;

// The pair a client holds (ADR-26). `access_token` keeps its name from the
// pre-refresh contract so existing clients keep working; `expires_in` is
// seconds until the access token expires, `refresh_token` is opaque.
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export type AuthResponse = TokenPair & { user: Partial<User> };

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  async register(registerDto: RegisterDto, ip: string | null = null): Promise<AuthResponse> {
    const { email, password, firstName, lastName } = registerDto;

    // Check if user already exists
    const existingUser = await this.usersRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const user = this.usersRepository.create({
      email,
      password: hashedPassword,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      active: true,
      // ADR-107: derived from the address, never from the request body --
      // the canary registers through this same route, and no caller may
      // hand itself the flag that takes it out of analytics.
      isCanary: isCanaryEmail(email),
    });

    // The findOne check above doesn't stop two concurrent registrations of
    // the same email from both passing it before either saves (M3) -- the
    // loser then hits the `users.email` unique constraint. Map that the same
    // way ProfilesService already does for its own unique constraint,
    // instead of letting a raw 23505 fall through as an unhandled 500.
    try {
      await this.usersRepository.save(user);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    return { ...(await this.issueTokens(user, null, ip)), user: this.publicUser(user) };
  }

  async login(loginDto: LoginDto, ip: string | null = null): Promise<AuthResponse> {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is active
    if (!user.active) {
      throw new UnauthorizedException('User account is inactive');
    }

    return { ...(await this.issueTokens(user, null, ip)), user: this.publicUser(user) };
  }

  // Rotation (ADR-26): the presented token is revoked and replaced by a new
  // one in the same family. A token that is already revoked is a replay --
  // either the client retried after a lost response or the token was
  // stolen; both are answered the same way, by revoking the whole family
  // (every descendant of that login) and auditing it, so a thief and the
  // rightful client are both signed out and the account owner logs in
  // again. Expired and unknown tokens are simply refused.
  async refresh(rawToken: string, ip: string | null = null): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(rawToken);
    const stored = await this.refreshTokensRepository.findOne({ where: { tokenHash } });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId, 'reuse_detected');
      await this.audit.record({
        actorUserId: stored.userId,
        action: 'auth.refresh.reuse_detected',
        resource: 'user',
        resourceId: stored.userId,
        status: 'failed',
        reason: `family ${stored.familyId}`,
        ip,
      });
      throw new UnauthorizedException('Refresh token was already used');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const user = await this.usersRepository.findOne({ where: { id: stored.userId } });
    // H2's rule at the refresh door too: a deactivated account gets no new
    // access token, and its remaining sessions are closed.
    if (!user || !user.active) {
      await this.revokeFamily(stored.familyId, 'deactivated');
      throw new UnauthorizedException('User account is inactive');
    }
    return this.issueTokens(user, stored, ip);
  }

  // Ends one session (the presented refresh token) or, with `all`, every
  // session of the account. The access token stays valid until it expires
  // -- that is what the short JWT_ACCESS_TTL is for.
  async logout(userId: string, rawToken: string | undefined, all: boolean, ip: string | null = null): Promise<{ revoked: number }> {
    let revoked = 0;
    if (all) {
      const result = await this.refreshTokensRepository.update(
        { userId, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'logout_all' },
      );
      revoked = result.affected ?? 0;
    } else if (rawToken) {
      const result = await this.refreshTokensRepository.update(
        { userId, tokenHash: hashRefreshToken(rawToken), revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'logout' },
      );
      revoked = result.affected ?? 0;
    }
    await this.audit.record({
      actorUserId: userId,
      action: all ? 'auth.logout_all' : 'auth.logout',
      resource: 'user',
      resourceId: userId,
      status: 'ok',
      reason: `revoked ${revoked}`,
      ip,
    });
    return { revoked };
  }

  // Called by JwtStrategy on every guarded request; the result becomes
  // req.user, so it must never carry the password hash (see SafeUser).
  // Passport treats a null return as "authentication failed" (401) the same
  // way it already does for "no such user" -- so a deactivated account's
  // still-valid JWT (login() rejects new logins, but this guard path is what
  // every other request actually runs) is rejected the same way, not just
  // at the login endpoint (H2, an independent audit's finding: this check
  // was missing here, so a deactivated account kept API access for the rest
  // of its 7-day token lifetime).
  async validateUser(userId: string): Promise<SafeUser | null> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.active) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      active: user.active,
      role: user.role,
      isCanary: user.isCanary,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // Account settings: change password while signed in (owner-approved design
  // 2026-09-06) -- distinct from PasswordResetService, which is what an
  // unauthenticated person uses instead. Ends every *other* session (the
  // caller's own `refresh_token`, when presented, survives); a reset ends
  // all of them because it answers a fear the account itself was
  // compromised, which changing your own password on purpose does not.
  async changePassword(userId: string, dto: ChangePasswordDto, ip: string | null = null): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException('User not found');
    }

    const validPassword = await bcrypt.compare(dto.currentPassword, user.password);
    if (!validPassword) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.usersRepository.update({ id: user.id }, { password: await bcrypt.hash(dto.newPassword, 10) });

    if (dto.refresh_token) {
      await this.refreshTokensRepository.update(
        { userId: user.id, tokenHash: Not(hashRefreshToken(dto.refresh_token)), revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'password_changed' },
      );
    } else {
      await this.refreshTokensRepository.update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'password_changed' },
      );
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_changed',
      resource: 'user',
      resourceId: user.id,
      status: 'ok',
      reason: null,
      ip,
    });
  }

  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // One access token (signed, short-lived) plus one refresh token (random,
  // stored only as a hash). `previous` is the token being rotated away.
  private async issueTokens(user: User, previous: RefreshToken | null, ip: string | null): Promise<TokenPair> {
    const raw = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const row = this.refreshTokensRepository.create({
      id,
      userId: user.id,
      tokenHash: hashRefreshToken(raw),
      // A new login starts a new family; its first row names itself.
      familyId: previous?.familyId ?? id,
      expiresAt: new Date(Date.now() + getRefreshTokenTtlDays() * DAY_MS),
      ipHash: ip ? this.audit.hashIp(ip) : null,
    });
    const saved = await this.refreshTokensRepository.save(row);
    if (previous) {
      await this.refreshTokensRepository.update(
        { id: previous.id },
        { revokedAt: new Date(), revokedReason: 'rotated', replacedById: saved.id },
      );
    }

    const access_token = this.jwtService.sign({ sub: user.id, email: user.email });
    return { access_token, refresh_token: raw, token_type: 'Bearer', expires_in: this.secondsUntilExpiry(access_token) };
  }

  private secondsUntilExpiry(accessToken: string): number {
    const payload = this.jwtService.decode(accessToken) as { exp?: number; iat?: number } | null;
    if (!payload?.exp || !payload.iat) {
      return 0;
    }
    return payload.exp - payload.iat;
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.refreshTokensRepository.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  private publicUser(user: User): Partial<User> {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
