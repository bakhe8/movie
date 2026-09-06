import { IsEmail, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../email';

export class RequestEmailChangeDto {
  @NormalizeEmail()
  @IsEmail()
  newEmail: string;

  // Re-authentication before a sensitive change (same discipline as
  // /privacy/export and /privacy/delete): a stolen access token alone
  // cannot move an account to an address its owner never chose.
  @IsString()
  currentPassword: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @MaxLength(200)
  token: string;
}
