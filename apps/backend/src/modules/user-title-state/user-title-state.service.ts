import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { TitleState, UserTitleState } from '../../entities/user-title-state.entity';
import { PosterService } from '../public-quality/poster.service';
import { UpdateTitleStateDto } from './dto/update-title-state.dto';

@Injectable()
export class UserTitleStateService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Title)
    private readonly titlesRepository: Repository<Title>,
    @InjectRepository(UserTitleState)
    private readonly statesRepository: Repository<UserTitleState>,
    private readonly posterService: PosterService,
  ) {}

  async upsert(
    userId: string,
    profileId: string,
    titleId: string,
    updateTitleStateDto: UpdateTitleStateDto,
  ): Promise<UserTitleState> {
    await this.assertProfileOwnership(userId, profileId);
    const title = await this.titlesRepository.findOne({ where: { id: titleId } });
    if (!title) {
      throw new NotFoundException('Title not found');
    }

    const existing = await this.statesRepository.findOne({ where: { profileId, titleId } });
    const state = this.applyUpdate(existing ?? this.statesRepository.create({ profileId, titleId }), updateTitleStateDto);

    try {
      return await this.statesRepository.save(state);
    } catch (error) {
      if (existing || !this.isUniqueConstraintError(error)) {
        throw error;
      }
      // Lost a race to a concurrent first write for the same (profile,
      // title) -- a double-fired PATCH, or WatchEventsService.create()'s own
      // call into this upsert -- and @Unique(['profileId', 'titleId'])
      // refused the second INSERT. Re-read the winner's row and apply this
      // update on top of it: exactly what a sequential second call would
      // have done, instead of a raw 500 (AUDIT_2026-09-05 H2; the same
      // lost-race handling TriadsService and AuthService.register use).
      const winner = await this.statesRepository.findOne({ where: { profileId, titleId } });
      if (!winner) {
        throw error;
      }
      return this.statesRepository.save(this.applyUpdate(winner, updateTitleStateDto));
    }
  }

  // The PATCH's effect on a row -- freshly created, found, or re-read after
  // a lost race -- kept in one place so the retry cannot drift from the
  // first attempt.
  private applyUpdate(state: UserTitleState, updateTitleStateDto: UpdateTitleStateDto): UserTitleState {
    state.state = updateTitleStateDto.state;

    // watchedAt/watchedOn only mean anything for state 'watched' (M1): a
    // caller-supplied value is ignored for any other state instead of being
    // stored alongside it, and both are cleared on any transition away from
    // 'watched' — consistent with TriadsService.replace()'s not_watched
    // path, which already nulls watchedAt the same way for the same reason.
    if (updateTitleStateDto.state === 'watched') {
      state.watchedAt = state.watchedAt ?? new Date();
      // ADR-104: omitting watchedOn leaves an already-set day alone (PATCH
      // semantics -- a notes-only diary save must never move the date);
      // a first-ever watch with no date supplied stays unknown (NULL, never
      // guessed from this server's own clock, DATE-01) rather than silently
      // defaulting to a day the client never actually claimed.
      state.watchedOn = updateTitleStateDto.watchedOn ?? state.watchedOn ?? null;
    } else {
      state.watchedAt = null;
      state.watchedOn = null;
    }

    // PATCH semantics (M1): notes is only touched when the caller actually
    // sends the field. Omitting it from the body must not silently wipe
    // existing notes — `undefined` means "leave alone", not "clear" (a
    // caller can still clear it explicitly with `notes: null`).
    if (updateTitleStateDto.notes !== undefined) {
      state.notes = updateTitleStateDto.notes;
    }

    // importedRating/ratingSource are intentionally untouched here — this endpoint never
    // writes a rating (see UpdateTitleStateDto). Only a future import path may set them.
    return state;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  async findByState(userId: string, profileId: string, state: TitleState): Promise<UserTitleState[]> {
    await this.assertProfileOwnership(userId, profileId);
    const rows = await this.statesRepository.find({
      where: { profileId, state },
      relations: { title: true },
      order: { updatedAt: 'DESC' },
    });
    // The poster travels with the title on this surface too (ADR-82).
    const posters = await this.posterService.forTitles(rows.map((row) => row.title).filter(Boolean));
    return rows.map((row) => {
      const poster = row.title ? posters.get(row.title.id) : undefined;
      return row.title
        ? { ...row, title: { ...row.title, posterUrl: poster?.posterUrl ?? null, posterSource: poster?.posterSource ?? null } }
        : row;
    }) as UserTitleState[];
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }
}