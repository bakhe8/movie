import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Title } from '../../entities/title.entity';
import { TitleState, UserTitleState } from '../../entities/user-title-state.entity';
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
    state.watchedAt = updateTitleStateDto.watchedAt
      ? new Date(updateTitleStateDto.watchedAt)
      : updateTitleStateDto.state === 'watched'
        ? state.watchedAt ?? new Date()
        : null;
    state.rating = updateTitleStateDto.rating ?? null;
    state.notes = updateTitleStateDto.notes ?? null;
    return this.statesRepository.save(state);
  }

  async findByState(userId: string, profileId: string, state: TitleState): Promise<UserTitleState[]> {
    await this.assertProfileOwnership(userId, profileId);
    return this.statesRepository.find({
      where: { profileId, state },
      relations: { title: true },
      order: { updatedAt: 'DESC' },
    });
  }

  private async assertProfileOwnership(userId: string, profileId: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
  }
}