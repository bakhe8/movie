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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('IDX_consents_userId')
  @Column()
  userId: string;

  @Column({ type: 'varchar' })
  purpose: ConsentPurpose;

  @Column()
  version: string;

  @Column()
  granted: boolean;

  @Column()
  grantedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
