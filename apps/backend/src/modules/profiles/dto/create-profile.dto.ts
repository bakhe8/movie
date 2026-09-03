import { IsIn, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { PreferredLanguage } from '../../../entities/profile.entity';

export class CreateProfileDto {
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: PreferredLanguage;
}