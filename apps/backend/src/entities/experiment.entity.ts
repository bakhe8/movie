import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('experiments')
export class Experiment {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'text' })
  hypothesis: string;

  @Column()
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'json', nullable: true })
  config: Record<string, unknown> | null;
}
