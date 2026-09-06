import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { PrivacyRequest } from '../../entities/privacy-request.entity';
import { Profile } from '../../entities/profile.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import type { Actor } from './admin-catalog.service';
import { ListAuditLogQueryDto, ListPrivacyRequestsQueryDto, ListUsersQueryDto, UpdateUserDto } from './dto/admin.dto';

export interface AdminUserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  active: boolean;
  profiles: number;
  createdAt: Date;
}

// Internal board, operations half: accounts (deactivation is the account-
// takeover control of BP §21.3; H2's e2e proves a deactivated account is
// out at once), the privacy-request queue (PRIVACY.md §5/§10) and the
// audit log reader (BP §21.3 "least privilege and audit logs for staff").
@Injectable()
export class AdminOpsService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(PrivacyRequest)
    private readonly privacyRequests: Repository<PrivacyRequest>,
    @InjectRepository(AuditLog)
    private readonly auditLog: Repository<AuditLog>,
    private readonly audit: AuditService,
  ) {}

  async listUsers(query: ListUsersQueryDto) {
    const [rows, total] = await this.users.findAndCount({
      where: query.query ? { email: ILike(`%${query.query}%`) } : {},
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const counts = rows.length
      ? await this.profiles
          .createQueryBuilder('p')
          .select('p.userId', 'userId')
          .addSelect('COUNT(*)', 'count')
          .where('p.userId IN (:...ids)', { ids: rows.map((row) => row.id) })
          .groupBy('p.userId')
          .getRawMany<{ userId: string; count: string }>()
      : [];
    const byUser = new Map(counts.map((c) => [c.userId, Number(c.count)]));
    const items: AdminUserRow[] = rows.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      role: user.role,
      active: user.active,
      profiles: byUser.get(user.id) ?? 0,
      createdAt: user.createdAt,
    }));
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  // An admin cannot change their own role or active flag: the last admin
  // locking themselves out, or demoting themselves by accident, is the
  // classic failure this rule prevents. Deactivation also closes every
  // live session so the account is out at once, not at token expiry.
  async updateUser(userId: string, dto: UpdateUserDto, actor: Actor): Promise<AdminUserRow> {
    if (userId === actor.id && (dto.active !== undefined || dto.role !== undefined)) {
      throw new ForbiddenException({ statusCode: 403, message: 'An admin cannot change their own role or status', error: 'Forbidden', reason: 'self_change' });
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // ADMIN-W4: self-change is already blocked above, but nothing stopped one
    // admin from deactivating or demoting the *other* last remaining admin,
    // locking every admin out with no one left to reverse it. Block exactly
    // that: demoting/deactivating an active admin when they are the only one.
    const demoting = user.role === 'admin' && ((dto.active === false && user.active) || dto.role === 'user');
    if (demoting) {
      const otherActiveAdmins = await this.users.count({ where: { role: 'admin', active: true, id: Not(userId) } });
      if (otherActiveAdmins === 0) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Cannot deactivate or demote the last active admin',
          error: 'Forbidden',
          reason: 'last_admin',
        });
      }
    }
    const changed: string[] = [];
    if (dto.active !== undefined && dto.active !== user.active) {
      user.active = dto.active;
      changed.push(`active=${dto.active}`);
    }
    if (dto.role !== undefined && dto.role !== user.role) {
      user.role = dto.role;
      changed.push(`role=${dto.role}`);
    }
    const saved = await this.users.save(user);
    let revoked = 0;
    if (dto.active === false) {
      const result = await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: 'deactivated' });
      revoked = result.affected ?? 0;
    }
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.user.update',
      resource: 'user',
      resourceId: userId,
      status: 'ok',
      reason: [changed.join(', ') || 'no change', revoked ? `sessions revoked ${revoked}` : null, dto.reason ?? null].filter(Boolean).join('; '),
      ip: actor.ip,
    });
    const profiles = await this.profiles.count({ where: { userId } });
    return {
      id: saved.id,
      email: saved.email,
      firstName: saved.firstName ?? null,
      lastName: saved.lastName ?? null,
      role: saved.role,
      active: saved.active,
      profiles,
      createdAt: saved.createdAt,
    };
  }

  async listPrivacyRequests(query: ListPrivacyRequestsQueryDto) {
    const [items, total] = await this.privacyRequests.findAndCount({
      where: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status as PrivacyRequest['status'] } : {}),
      },
      order: { requestedAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async listAuditLog(query: ListAuditLogQueryDto) {
    const [items, total] = await this.auditLog.findAndCount({
      where: {
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.action ? { action: ILike(`${query.action}%`) } : {}),
        ...(query.resource ? { resource: query.resource } : {}),
        ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }
}
