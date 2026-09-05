import { Controller, Get, Param, ParseUUIDPipe, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProfileReadinessService } from './profile-readiness.service';

// GET /profiles/:profileId/readiness (ADR-103, remediation brief §5.1): the
// four capabilities the brief found conflated into one "trained or not"
// flag, each with its own status, reason and what the user could do next.
@Controller('profiles/:profileId')
@UseGuards(AuthGuard('jwt'))
export class ProfileReadinessController {
  constructor(private readonly readiness: ProfileReadinessService) {}

  @Get('readiness')
  forProfile(@Request() request: { user: { id: string } }, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.readiness.forProfile(request.user.id, profileId);
  }
}
