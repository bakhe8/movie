import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// BP §7.5: a population factor model retrained on a schedule; a
// user_model_snapshot calibrates against one version of it. Seeding before
// internal data exists is allowed only from data licensed for this
// commercial use (RANKING_ALGORITHM.md §11) -- seedDataSources[].licenseStatus
// must be 'commercial_allowed' for a version to be activated.
@Entity('shared_latent_space_versions')
export class SharedLatentSpaceVersion {
  @PrimaryColumn({ type: 'varchar' })
  version: string;

  @Column({ type: 'integer', nullable: true })
  nFactors: number | null;

  @Column({ type: 'json', default: '[]' })
  seedDataSources: unknown[];

  @Column({ type: 'integer', nullable: true })
  trainingCohortSize: number | null;

  @Column({ type: 'json', nullable: true })
  acceptanceGateMetrics: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
