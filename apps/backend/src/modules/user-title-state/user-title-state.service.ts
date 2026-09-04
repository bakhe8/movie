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
    const state = existing ?? this.statesRepository.create({ profileId, titleId });
    state.state = updateTitleStateDto.state;

    // watchedAt only means anything for state 'watched' (M1): a caller-
    // supplied value is ignored for any other state instead of being stored
    // alongside it, and it's cleared on any transition away from 'watched' —
    // consistent with TriadsService.replace()'s not_watched path, which
    // already nulls it the same way for the same reason.
    state.watchedAt =
      updateTitleStateDto.state === 'watched'
        ? updateTitleStateDto.watchedAt
          ? new Date(updateTitleStateDto.watchedAt)
          : (state.watchedAt ?? new Date())
        : null;

    // PATCH semantics (M1): notes is only touched when the caller actually
    // sends the field. Omitting it from the body must not silently wipe
    // existing notes — `undefined` means "leave alone", not "clear" (a
    // caller can still clear it explicitly with `notes: null`).
    if (updateTitleStateDto.notes !== undefined) {
      state.notes = updateTitleStateDto.notes;
    }

    // importedRating/ratingSource are intentionally untouched here — this endpoint never
    // writes a rating (see UpdateTitleStateDto). Only a future import path may set them.
    return this.statesRepository.save(state);
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