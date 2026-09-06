import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import { getAccessTokenTtl, getJwtSecret } from '../../config/jwt.config';
import { AuditModule } from '../audit/audit.module';
import { PasswordReset } from '../../entities/password-reset.entity';
import { EmailChange } from '../../entities/email-change.entity';
import { PasswordResetService } from './password-reset.service';
import { EmailChangeService } from './email-change.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, PasswordReset, EmailChange]),
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      // Short-lived now that /auth/refresh exists (ADR-26); JWT_ACCESS_TTL.
      signOptions: { expiresIn: getAccessTokenTtl() as `${number}${'s' | 'm' | 'h' | 'd'}` },
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordResetService, EmailChangeService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
