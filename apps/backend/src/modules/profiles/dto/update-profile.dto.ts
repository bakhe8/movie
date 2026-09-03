import { IsIn, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { PreferredLanguage } from '../../../entities/profile.entity';

export class UpdateProfileDto {
  // @IsOptional() means the field may be absent, not that it may be an empty
  // string once present -- @IsNotEmpty() still applies when `name` is sent
  // (matches CreateProfileDto; a profile name must never be blanked out).
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: PreferredLanguage;
}