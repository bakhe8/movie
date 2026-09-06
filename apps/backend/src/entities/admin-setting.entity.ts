import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// ADMIN-W6 (plan §17.3): the *current* value of a control-plane override --
// one row per settings key, present only once an admin has actually
// published a value for it. A key with no row here still has a value (the
// definition's own default, or an env var, AdminSettingsService.get()
// resolves which) -- absence means "using default/deploy", not "unset".
@Entity('admin_settings')
export class AdminSetting {
  // The definition's own key (AdminSettingDef.key), never a free-form name.
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'json' })
  value: unknown;

  // Bumped on every publish; rollback() creates a new version too, it never
  // rewrites history -- see admin_setting_versions.
  @Column({ type: 'int' })
  version: number;

  // NULL only if the schema ever needs a system-published default seeded
  // outside a request; every real publish has a real admin.
  @Column({ type: 'uuid', nullable: true })
  modifiedBy: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
