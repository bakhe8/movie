import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

// ALPHA_PLAN 3.2 (ADR-85). Same shape as refresh_tokens and for the same
// reason: only the SHA-256 of the opaque token is stored, so a database read
// never yields a usable credential. Single use -- `usedAt` is stamped the
// moment a token is spent, and requesting a new reset revokes any earlier
// unused one, so a link mailed twice never leaves two live doors.
@Entity('password_resets')
export class PasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('IDX_password_resets_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @Index('IDX_password_resets_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  // Salted hash, never the address itself (PRIVACY.md §1): enough to answer
  // "was this request for the account it claims" without a second copy of
  // the identifier.
  @Column({ type: 'varchar', nullable: true })
  ipHash: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
