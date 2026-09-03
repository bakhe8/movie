import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refresh_token: string;
}

export class LogoutDto {
  // The session to end. Omit with `all: true` to end every session of the
  // account (a "sign out everywhere" control).
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refresh_token?: string;

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
