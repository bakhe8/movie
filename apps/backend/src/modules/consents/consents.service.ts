import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consent } from '../../entities/consent.entity';
import { Profile } from '../../entities/profile.entity';
import { subjectKeyFor } from '../privacy/privacy.service';
import { ConsentGrantDto } from './dto/update-consents.dto';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(Consent)
    private readonly consentsRepository: Repository<Consent>,
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
  ) {}

  // PRIVACY.md §4's `no_pooled`: revoking `personalization_pooled` excludes
  // that user's profiles from the next shared-space retrain, and changes
  // nothing about their individual model. Default-on (PRIVACY.md §3), so
  // only an explicit, still-standing revocation excludes -- a user who never
  // answered is included, and one who revoked then re-granted is included
  // again (the row's `granted` is the current state, ADR-60).
  //
  // The shared latent space itself is unbuilt (ADR-13, narrowed by ADR-72),
  // so this is the boundary its retrain must read rather than re-deriving
  // consent later: any pooled job takes its profile set from here.
  async pooledEligibleProfileIds(): Promise<string[]> {
    const revoked = await this.consentsRepository.find({
      where: { purpose: 'personalization_pooled', granted: false },
      select: { userId: true },
    });
    const excludedUserIds = new Set(revoked.map((row) => row.userId).filter((id): id is string => id !== null));
    const profiles = await this.profilesRepository.find({ select: { id: true, userId: true } });
    return profiles.filter((profile) => !excludedUserIds.has(profile.userId)).map((profile) => profile.id);
  }

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
          // Written on creation so the row survives the account (ADR-80).
          subjectKey: subjectKeyFor(userId),
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
