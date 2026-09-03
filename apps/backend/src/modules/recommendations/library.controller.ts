import { Controller, Get, Param, ParseUUIDPipe, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RecommendationsService } from './recommendations.service';

// The library's personal ranking (blueprint §5.3, SPECIFICATION §5.4): the
// profile's watched titles ordered by the same model that ranks
// recommendations. Positions only -- no score leaves the server (ADR-33).
// Lives in the recommendations module because it is the same scoring path.
@Controller('profiles/:profileId/library')
@UseGuards(AuthGuard('jwt'))
export class LibraryController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('ranking')
  ranking(@Request() request: { user: { id: string } }, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.recommendationsService.rankLibrary(request.user.id, profileId);
  }
}
