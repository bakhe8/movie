import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

// ADR-26 (refresh tokens before Alpha; ALPHA_PLAN phase 3, item 3.1). Only
// the SHA-256 of the opaque token is stored, so a database read never yields
// a usable credential. Tokens rotate: each refresh revokes the presented row
// and issues a new one in the same family; presenting an already-revoked
// token is treated as theft and revokes the whole family. The user FK
// cascades, so a purged account (PrivacyService) loses every session with
// it; a deactivated account is refused at refresh time (users.active).
@Entity('refresh_tokens')
@Index('IDX_refresh_tokens_familyId', ['familyId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index('IDX_refresh_tokens_userId')
  @Column({ type: 'uuid' })
  userId: string;

  @Index('IDX_refresh_tokens_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  // The first token of a login names its own id; rotations inherit it.
  @Column({ type: 'uuid' })
  familyId: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  // 'rotated' | 'logout' | 'logout_all' | 'reuse_detected' | 'deactivated'
  @Column({ type: 'varchar', nullable: true })
  revokedReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  replacedById: string | null;

  @Column({ type: 'varchar', nullable: true })
  ipHash: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
