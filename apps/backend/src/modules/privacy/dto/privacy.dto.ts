import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// PRIVACY.md §5: identity re-verification before an export is delivered or
// a deletion is scheduled. The current password is the only second factor
// the product has (ADR-26 leaves MFA for later).
export class ReverifyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  password: string;
}

export class ResetTasteDto {
  @IsUUID()
  profileId: string;
}
