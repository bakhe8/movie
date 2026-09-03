import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

// PRIVACY.md §5's user-rights flows.
export type PrivacyRequestType = 'export' | 'delete' | 'reset';
export type PrivacyRequestStatus = 'requested' | 'verifying' | 'scheduled' | 'running' | 'done' | 'cancelled';

// A request is a tombstone: it outlives the user it names (PRIVACY.md §5,
// §9 "permanent record without personal data after deletion"). The FK is
// therefore ON DELETE SET NULL (migration PrivacyRequestsTombstone), and
// subjectKey -- a SHA-256 of the user id -- keeps a user's requests linked
// to each other after userId has been nulled, without keeping the id.
@Entity('privacy_requests')
export class PrivacyRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Index('IDX_privacy_requests_userId')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index('IDX_privacy_requests_subjectKey')
  @Column({ type: 'varchar', length: 64, nullable: true })
  subjectKey: string | null;

  // The profile a 'reset' applied to. Bare uuid, no FK: the profile may be
  // wiped later and this row must still say what happened.
  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @Column({ type: 'varchar' })
  type: PrivacyRequestType;

  @Column({ type: 'varchar' })
  status: PrivacyRequestStatus;

  @Column()
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  executeAfter: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  artifactUrl: string | null;

  @Column({ type: 'json', nullable: true })
  executionLog: Record<string, unknown> | null;
}
