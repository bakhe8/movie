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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}