import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consent } from '../../entities/consent.entity';
import { ConsentGrantDto } from './dto/update-consents.dto';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(Consent)
    private readonly consentsRepository: Repository<Consent>,
  ) {}

  async findForUser(userId: string): Promise<Consent[]> {
    return this.consentsRepository.find({ where: { userId }, order: { grantedAt: 'DESC' } });
  }

  // One row per (userId, purpose, version) -- upserts rather than appending,
  // matching the UNIQUE constraint on that triple (SCHEMA.md §2.2, M2).
  // grantedAt is set the first time a row is created and preserved across a
  // later revoke, so it always answers "when did this user first agree to
  // this exact policy text"; revokedAt answers "and when did they last take
  // it back", if ever. A grant/decline that matches the row's current state
  // is a no-op, so a resubmitted onboarding step doesn't touch either
  // timestamp.
  async update(userId: string, grants: ConsentGrantDto[]): Promise<Consent[]> {
    const results: Consent[] = [];
    for (const grant of grants) {
      const existing = await this.consentsRepository.findOne({
        where: { userId, purpose: grant.purpose, version: grant.version },
      });
      if (!existing) {
        const created = this.consentsRepository.create({
          userId,
          purpose: grant.purpose,
          version: grant.version,
          granted: grant.granted,
          grantedAt: new Date(),
          revokedAt: grant.granted ? null : new Date(),
        });
        results.push(await this.consentsRepository.save(created));
        continue;
      }

      if (grant.granted && !existing.granted) {
        existing.granted = true;
        existing.revokedAt = null;
        results.push(await this.consentsRepository.save(existing));
      } else if (!grant.granted && existing.granted) {
        existing.granted = false;
        existing.revokedAt = new Date();
        results.push(await this.consentsRepository.save(existing));
      } else {
        results.push(existing);
      }
    }
    return results;
  }
}
