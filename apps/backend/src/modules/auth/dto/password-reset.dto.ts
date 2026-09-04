import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  email: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @MaxLength(200)
  token: string;

  // Same bounds registration enforces, so a reset can never set a password
  // the sign-up flow would have rejected.
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;
}
