import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';

// PRIVACY.md §3's closed list of purposes; enforced at the application layer,
// not the database, since a DB check constraint would need a migration for
// every future purpose (e.g. the reserved email_recommendations/taste_card_sharing).
export type ConsentPurpose =
  | 'terms_privacy'
  | 'watch_history'
  | 'personalization_individual'
  | 'personalization_pooled'
  | 'import_processing'
  | 'analytics_first_party'
  | 'email_recommendations'
  | 'taste_card_sharing';

@Entity('consents')
@Unique('UQ_consents_userId_purpose_version', ['userId', 'purpose', 'version'])
export class Consent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // SET NULL, not CASCADE: PRIVACY.md §9 keeps consents as a permanent
  // record without personal data after a deletion, the same tombstone
  // privacy_requests carries (ConsentsTombstone, ADR-80).
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Index('IDX_consents_userId')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // sha256(userId), written on every row: links a purged user's consents to
  // each other, and to their privacy_requests, without keeping the id.
  @Index('IDX_consents_subjectKey')
  @Column({ type: 'varchar', length: 64, nullable: true })
  subjectKey: string | null;

  @Column({ type: 'varchar' })
  purpose: ConsentPurpose;

  @Column({ type: 'varchar' })
  version: string;

  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ type: 'timestamp' })
  grantedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
