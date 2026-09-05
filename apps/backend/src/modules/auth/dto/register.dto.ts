import { IsEmail, IsNotEmpty, IsOptional, MinLength, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../email';

export class RegisterDto {
  // Folded before validation (auth/email.ts): one spelling per account.

  @NormalizeEmail()

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  password: string;

  // Optional since 2026-09-05 (owner's interaction addendum: ask for nothing
  // the experience does not use). A name appears on no screen but the
  // profile's own account card and enters no model, so the door stops asking
  // for one. A client that still sends one is still accepted, and the columns
  // were always nullable.
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @MaxLength(100)
  lastName?: string;
}
