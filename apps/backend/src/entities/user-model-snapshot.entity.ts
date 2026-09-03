import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';

@Entity('user_model_snapshots')
export class UserModelSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column()
  profileId: string;

  @Column('real', { array: true })
  weights: number[];

  @Column({ type: 'json', nullable: true })
  biasTerms: Record<string, number>;

  @Column()
  modelVersion: string;

  @Column({ type: 'integer' })
  trainingTriadCount: number;

  @Column('real', { nullable: true })
  validationAccuracy: number;

  @Column('real', { nullable: true })
  pairwiseAccuracy: number;

  @CreateDateColumn()
  createdAt: Date;
}