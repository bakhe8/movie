import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Title } from './title.entity';

// Provenance behind titles.fingerprint: one row per (title, feature, version).
// value NULL means unknown, never 0 (BP §11.3) -- readers must skip it, not
// coerce. titles.fingerprint stays the published, versioned snapshot the
// model actually reads; this table is what backs each of its numbers.
@Entity('content_features')
@Unique('UQ_content_features_titleId_featureKey_extractorVersion', ['titleId', 'featureKey', 'extractorVersion'])
export class ContentFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column({ type: 'uuid' })
  titleId: string;

  @Column()
  featureKey: string;

  @Column({ type: 'real', nullable: true })
  value: number | null;

  @Column({ type: 'json', nullable: true })
  distribution: Record<string, unknown> | null;

  @Column({ type: 'real', nullable: true })
  uncertainty: number | null;

  @Column('text', { array: true, default: '{}' })
  sourceIds: string[];

  @Column()
  extractorVersion: string;

  @Column({ type: 'varchar' })
  licenseStatus: string;

  @Column({ type: 'varchar' })
  reviewStatus: string;

  @Column({ type: 'timestamp' })
  validFrom: Date;

  @ManyToOne(() => ContentFeature, { nullable: true })
  @JoinColumn({ name: 'supersededBy' })
  supersededByFeature: ContentFeature | null;

  @Column({ type: 'uuid', nullable: true })
  supersededBy: string | null;
}
