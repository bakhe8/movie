import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// ADMIN-W6 (plan §17.3 "سجل النسخ"): append-only history behind
// `admin_settings` -- every publish (including a rollback, which is a
// publish of an old value under a new version) writes one row here and is
// never edited or deleted. This is what "قابل للتراجع" (§18 W6 closing gate)
// actually means: the value to roll back to always still exists.
@Entity('admin_setting_versions')
export class AdminSettingVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_admin_setting_versions_key')
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'json' })
  value: unknown;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'uuid', nullable: true })
  modifiedBy: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
