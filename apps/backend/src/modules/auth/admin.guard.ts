import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { SafeUser } from './auth.service';

// users.role gates the internal board (BP §5.1, ADR-26; ALPHA_PLAN phase 3,
// item 3.3). Apply after AuthGuard('jwt'): `@UseGuards(AuthGuard('jwt'),
// AdminGuard)`. A signed-in non-admin gets 403, never 404 -- admin routes
// are not secrets, only their data is.
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: SafeUser }>();
    if (request.user?.role !== 'admin') {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Admin role required',
        error: 'Forbidden',
        reason: 'admin_required',
      });
    }
    return true;
  }
}
