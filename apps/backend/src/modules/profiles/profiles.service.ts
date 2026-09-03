import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
  ) {}

  async create(userId: string, createProfileDto: CreateProfileDto): Promise<Profile> {
    const profile = this.profilesRepository.create({
      userId,
      name: createProfileDto.name,
      preferredLanguage: createProfileDto.preferredLanguage ?? 'ar',
    });

    try {
      return await this.profilesRepository.save(profile);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A profile with this name already exists');
      }
      throw error;
    }
  }

  findAll(userId: string): Promise<Profile[]> {
    return this.profilesRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(userId: string, profileId: string): Promise<Profile> {
    const profile = await this.profilesRepository.findOne({
      where: { id: profileId, userId },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  async update(
    userId: string,
    profileId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<Profile> {
    const profile = await this.findOne(userId, profileId);
    Object.assign(profile, updateProfileDto);

    try {
      return await this.profilesRepository.save(profile);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A profile with this name already exists');
      }
      throw error;
    }
  }

  async remove(userId: string, profileId: string): Promise<void> {
    const profile = await this.findOne(userId, profileId);
    await this.profilesRepository.remove(profile);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}