import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('experiments')
export class Experiment {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'text' })
  hypothesis: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'json', nullable: true })
  config: Record<string, unknown> | null;
}
