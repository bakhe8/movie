import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

// PRIVACY.md §5's user-rights flows.
export type PrivacyRequestType = 'export' | 'delete' | 'reset';
export type PrivacyRequestStatus = 'requested' | 'verifying' | 'scheduled' | 'running' | 'done' | 'cancelled';

// No onDelete on the userId FK, matching SCHEMA.md's DDL exactly: PRIVACY.md
// §5 treats this row as a tombstone that should survive the user it names,
// which is in tension with a NOT NULL FK to a row a future delete flow would
// remove. No delete flow exists yet (blueprint gap 7) -- left for whoever
// builds it to resolve deliberately (SET NULL vs. a denormalized snapshot),
// not to decide silently in a schema-only migration.
@Entity('privacy_requests')
export class PrivacyRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('IDX_privacy_requests_userId')
  @Column()
  userId: string;

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
