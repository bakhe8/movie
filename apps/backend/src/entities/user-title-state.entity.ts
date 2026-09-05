import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { Title } from './title.entity';

export type TitleState = 'watched' | 'not_watched' | 'watchlist' | 'interested';

@Entity('user_title_states')
@Unique('UQ_user_title_states_profileId_titleId', ['profileId', 'titleId'])
export class UserTitleState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column({ type: 'uuid' })
  profileId: string;

  @ManyToOne(() => Title, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'titleId' })
  title: Title;

  @Column({ type: 'uuid' })
  titleId: string;

  @Column({ type: 'varchar' })
  state: TitleState;

  // Legacy bookkeeping timestamp (UTC instant), superseded for display by
  // watchedOn below (ADR-104, remediation brief P1-03/DATE-01) -- nothing
  // reads it for "which day" any more, only ever written for continuity.
  @Column({ type: 'timestamp', nullable: true })
  watchedAt: Date | null;

  // The calendar day the user says they watched it, as plain 'YYYY-MM-DD'
  // text -- deliberately never a native date/timestamp column. The bug this
  // fixes was exactly a driver/timezone silently shifting a day: a title
  // marked watched just after local midnight in Riyadh (UTC+3) stored the
  // server's UTC "now", which was still the previous day there. The client
  // now always supplies its own local calendar day (lib/format.ts's
  // todayLocal()) or, from the diary, the exact day the user chose; the
  // backend only ever stores the string it is given, verbatim, never
  // guessing one from a server clock. NULL for a state that has never been
  // 'watched', and for rows written before this column existed.
  @Column({ type: 'varchar', length: 10, nullable: true })
  watchedOn: string | null;

  // Whether this watched title may still be asked about in a triad. Cleared
  // by the "don't remember" replacement control (ADR-17): the watch stays
  // (the title is not recommendable) but the user is never asked to rank
  // it again. Only TriadsService.replace() writes false; nothing sets it
  // back today. Not a preference signal -- never read by training.
  @Column({ type: 'boolean', default: true })
  triadEligible: boolean;

  // Never written by the general in-app state-update endpoint — see UpdateTitleStateDto.
  // The only legitimate writer is a future import pipeline (e.g. a user-provided CSV list),
  // which must also set ratingSource: 'import'. This is a low-confidence auxiliary signal,
  // never a substitute for a triad ranking (blueprint §2.4 principle #2, §4.2, §4.5).
  @Column('real', { nullable: true })
  importedRating: number | null;

  @Column({ type: 'varchar', nullable: true })
  ratingSource: 'import' | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}