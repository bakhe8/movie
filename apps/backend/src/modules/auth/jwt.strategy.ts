import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../../config/jwt.config';
import { AuthService, type SafeUser } from './auth.service';

// Shape of the token signed in AuthService.register()/login().
interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Return value becomes req.user on every guarded route -- must never
  // include the password hash (AuthService.validateUser enforces this).
  async validate(payload: JwtPayload): Promise<SafeUser | null> {
    return this.authService.validateUser(payload.sub);
  }
}
