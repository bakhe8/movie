import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { RecommendationsService } from './recommendations.service';

@Controller('profiles/:profileId/recommendations')
@UseGuards(AuthGuard('jwt'))
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get()
  findForProfile(
    @Request() request: { user: { id: string } },
    @Param('profileId') profileId: string,
    @Query() query: RecommendationsQueryDto,
  ) {
    return this.recommendationsService.findForProfile(request.user.id, profileId, query.limit);
  }
}