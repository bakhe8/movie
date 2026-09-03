import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';

export interface AuditEntry {
  // null = the system itself (a scheduled job), not a person.
  actorUserId?: string | null;
  actorRole?: string | null;
  // 'privacy.export', 'privacy.delete.scheduled', 'admin.title.update', ...
  action: string;
  resource: string;
  resourceId?: string | null;
  status: 'ok' | 'failed' | 'scheduled' | 'cancelled';
  reason?: string | null;
  // Raw client address; only its salted hash is stored.
  ip?: string | null;
}

// The one writer for audit_log (BP §21.1/§21.3; ALPHA_PLAN phase 2, item
// 2.3). Append-only by construction: nothing here updates or deletes.
// Callers that act inside a transaction pass its EntityManager so the audit
// row commits or rolls back with the action it describes.
@Injectable()
export class AuditService {
  private readonly ipSalt: string;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
    config: ConfigService,
  ) {
    this.ipSalt = config.get<string>('AUDIT_IP_SALT') ?? '';
  }

  async record(entry: AuditEntry, manager?: EntityManager): Promise<AuditLog> {
    const row: Partial<AuditLog> = {
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      status: entry.status,
      reason: entry.reason ? entry.reason.slice(0, 500) : null,
      ipHash: entry.ip ? this.hashIp(entry.ip) : null,
    };
    if (manager) {
      return manager.save(manager.create(AuditLog, row));
    }
    return this.auditRepository.save(this.auditRepository.create(row));
  }

  hashIp(ip: string): string {
    return createHash('sha256').update(`${this.ipSalt}${ip}`).digest('hex').slice(0, 32);
  }
}
