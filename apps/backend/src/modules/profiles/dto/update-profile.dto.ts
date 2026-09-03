import { IsIn, IsOptional, MaxLength } from 'class-validator';
import { PreferredLanguage } from '../../../entities/profile.entity';

export class UpdateProfileDto {
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: PreferredLanguage;
}