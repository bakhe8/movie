import { IsEmail, IsNotEmpty } from 'class-validator';
import { NormalizeEmail } from '../email';

export class LoginDto {
  @NormalizeEmail()

  @IsEmail()
  email: string;

  @IsNotEmpty()
  password: string;
}
