import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export type MailOutboxStatus = 'pending' | 'delivered' | 'dead';

// ADR-97: every outgoing mail is a row first and a provider call second, so
// a provider outage or a crashed process loses nothing and an operator can
// see where each message stands. The body is sealed with AES-256-GCM under
// a key derived from JWT_SECRET (mail/mail-body-cipher.ts) and wiped the
// moment the row leaves `pending`: a password-reset mail carries a live
// link, and ADR-85's rule that a database read never yields a usable
// credential still holds. Cascades with the account like password_resets.
@Entity('mail_outbox')
@Index('IDX_mail_outbox_status_nextAttemptAt', ['status', 'nextAttemptAt'])
export class MailOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Index('IDX_mail_outbox_userId')
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  // What the message is for ('password_reset'); never free text from a user.
  @Column({ type: 'varchar', length: 64 })
  kind: string;

  @Column({ type: 'varchar' })
  toAddress: string;

  @Column({ type: 'varchar' })
  subject: string;

  // iv || auth tag || ciphertext; NULL once the row is delivered or dead.
  @Column({ type: 'bytea', nullable: true })
  bodySealed: Buffer | null;

  // The HTML part, sealed with the same key -- it carries the same link.
  // NULL for a text-only message and once the row is delivered or dead.
  @Column({ type: 'bytea', nullable: true })
  htmlSealed: Buffer | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: MailOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp' })
  nextAttemptAt: Date;

  // A message that is useless after a point (a reset link past its TTL) is
  // not retried past it; NULL means retry until the attempt cap.
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  // The provider's or transport's message, truncated; never the body.
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @Column({ type: 'varchar', nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
