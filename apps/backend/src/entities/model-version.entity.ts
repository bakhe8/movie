import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('model_versions')
export class ModelVersion {
  @PrimaryColumn()
  version: string;

  @Column()
  rankerType: string;

  @Column()
  fingerprintSchemaVersion: string;

  @Column({ type: 'varchar', nullable: true })
  codeRef: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dataCutoff: Date | null;

  @Column({ type: 'json', nullable: true })
  features: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  thresholds: Record<string, unknown> | null;

  // BP §16.2 metrics including slices and baselines.
  @Column({ type: 'json', nullable: true })
  evalReport: Record<string, unknown> | null;

  @Column({ default: false })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
