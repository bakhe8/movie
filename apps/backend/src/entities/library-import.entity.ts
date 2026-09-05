import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Profile } from './profile.entity';

@Entity('library_imports')
export class LibraryImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Index('IDX_library_imports_profileId')
  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  fileName: string | null;

  @Column({ type: 'integer', nullable: true })
  rowCount: number | null;

  @Column({ type: 'integer', nullable: true })
  matchedCount: number | null;

  @Column({ type: 'varchar' })
  consentVersion: string;

  @Column({ type: 'timestamp', nullable: true })
  rawDeletedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  createdAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
