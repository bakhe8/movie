import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Title } from './title.entity';

export type TitleState = 'watched' | 'not_watched' | 'watchlist' | 'interested';

@Entity('user_title_state')
@Unique(['profileId', 'titleId'])
export class UserTitleState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column()
  profileId: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column()
  titleId: string;

  @Column({ type: 'varchar' })
  state: TitleState;

  @Column({ type: 'timestamp', nullable: true })
  watchedAt: Date | null;

  @Column('real', { nullable: true })
  rating: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}