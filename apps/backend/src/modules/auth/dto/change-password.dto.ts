import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  // Same bounds registration enforces (register.dto.ts), so a change can
  // never set a password the sign-up flow would have rejected.
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword: string;

  // The session making this call. When present, that one session survives
  // the sweep that follows a password change; every other refresh token of
  // the account is revoked. Omitted (an older client, or a caller that
  // cannot present one), every session ends, matching password-reset's
  // behaviour.
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refresh_token?: string;
}
