import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

// Account settings: change email (owner-approved design 2026-09-06). Same
// shape and discipline as password_resets (ADR-85): only the SHA-256 of the
// opaque token is stored, single use, and a fresh request revokes any
// earlier unused one for the account. The difference from a password reset
// is what the link does when spent -- it writes `newEmail` onto the account
// instead of a new password -- and who it is mailed to: the address being
// claimed, never the current one, so nothing here can prove membership by
// mailing the account's existing address.
@Entity('email_changes')
export class EmailChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('IDX_email_changes_userId')
  @Column({ type: 'uuid' })
  userId: string;

  // Normalised the same way RegisterDto folds a new signup (auth/email.ts):
  // one spelling per address before it ever reaches this table.
  @Column({ type: 'varchar' })
  newEmail: string;

  @Index('IDX_email_changes_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
