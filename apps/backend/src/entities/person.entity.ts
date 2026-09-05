import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('people')
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'json', nullable: true })
  externalIds: Record<string, unknown> | null;
}
