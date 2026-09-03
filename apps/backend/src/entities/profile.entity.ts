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

@Entity('profiles')
@Unique(['userId', 'name'])
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ length: 255 })
  name: string;

  // Arabic-first product (blueprint §2, §5.1). Interface/market only -- never a
  // taste prior (blueprint §4.1, §10.2).
  @Column({ type: 'varchar', length: 5, default: 'ar' })
  preferredLanguage: PreferredLanguage;

  // Onboarding (blueprint §4.1, SPECIFICATION §5.1 step 2). Both shape
  // display and Watchability only -- never a taste prior (§4.1, §10.2).
  // market: ISO 3166-1 alpha-2; NULL until chosen, which is what the
  // onboarding screen keys on.
  @Column({ type: 'varchar', length: 2, nullable: true })
  market: string | null;

  // Platform identifiers the user says they can watch on (e.g. 'netflix').
  @Column('text', { array: true, default: '{}' })
  platforms: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}