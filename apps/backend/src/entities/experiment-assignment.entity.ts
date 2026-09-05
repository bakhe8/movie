import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Experiment } from './experiment.entity';
import { Profile } from './profile.entity';

@Entity('experiment_assignments')
export class ExperimentAssignment {
  @ManyToOne(() => Experiment)
  @JoinColumn({ name: 'experimentId' })
  experiment: Experiment;

  @PrimaryColumn({ type: 'varchar' })
  experimentId: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @PrimaryColumn('uuid')
  profileId: string;

  @Column({ type: 'varchar' })
  arm: string;

  @Column({ type: 'timestamp', nullable: true })
  assignedAt: Date | null;
}
