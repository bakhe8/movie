import { IsEmail, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
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

  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;
}
