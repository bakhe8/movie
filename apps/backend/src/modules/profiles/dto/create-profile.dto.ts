import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PreferredLanguage } from '../../../entities/profile.entity';

export class CreateProfileDto {
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: PreferredLanguage;

  // ISO 3166-1 alpha-2 (blueprint §4.1); display and Watchability only.
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  market?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  platforms?: string[];
}