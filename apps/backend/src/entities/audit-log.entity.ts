import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// No FK to users on actorUserId: an audit row must outlive the actor it
// names (blueprint §21.1/§21.3, PRIVACY.md §5 tombstone requirement), so it
// is stored as a bare uuid rather than a relation.
@Entity('audit_log')
@Index('IDX_audit_log_resource_resourceId', ['resource', 'resourceId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_audit_log_actorUserId')
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  @Column()
  action: string;

  @Column()
  resource: string;

  @Column({ type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column()
  status: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', nullable: true })
  ipHash: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
