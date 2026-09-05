import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export type PreferredLanguage = 'ar' | 'en';
export type PreferredAppearance = 'cinema' | 'premiere' | 'montage';

@Entity('profiles')
@Unique(['userId', 'name'])
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  // Arabic-first product (blueprint §2, §5.1). Interface/market only -- never a
  // taste prior (blueprint §4.1, §10.2).
  @Column({ type: 'varchar', length: 5, default: 'ar' })
  preferredLanguage: PreferredLanguage;

  // A display preference only; never an input to taste or recommendations.
  // Null preserves the browser/default appearance until an explicit choice.
  @Column({ type: 'varchar', length: 16, nullable: true })
  preferredAppearance: PreferredAppearance | null;

  // Onboarding (blueprint §4.1, SPECIFICATION §5.1 step 2). Both shape
  // display and Watchability only -- never a taste prior (§4.1, §10.2).
  // market: ISO 3166-1 alpha-2; NULL until chosen, which is what the
  // onboarding screen keys on.
  @Column({ type: 'varchar', length: 2, nullable: true })
  market: string | null;

  // Platform identifiers the user says they can watch on (e.g. 'netflix').
  @Column('text', { array: true, default: '{}' })
  platforms: string[];

  // NULL = not paused. Set when the user invokes the 'pause_all' privacy
  // restriction (PRIVACY.md §4), cleared on resume. No route reads or
  // writes this yet -- the restriction itself isn't built (M1, SCHEMA.md
  // §2.4).
  @Column({ type: 'timestamp', nullable: true })
  pausedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
