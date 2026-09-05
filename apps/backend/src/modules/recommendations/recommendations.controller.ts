import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { RecordImpressionsDto } from './dto/record-impressions.dto';
import { RecommendationsService } from './recommendations.service';

@Controller('profiles/:profileId/recommendations')
@UseGuards(AuthGuard('jwt'))
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get()
  findForProfile(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Query() query: RecommendationsQueryDto,
  ) {
    return this.recommendationsService.findForProfile(request.user.id, profileId, query.limit);
  }

  // ADR-110: the recommendation was created when it was chosen; this is the
  // separate fact that it reached a screen. 200, not 201 -- it creates
  // nothing, it stamps rows that already exist.
  @Post('impressions')
  @HttpCode(200)
  recordImpressions(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: RecordImpressionsDto,
  ) {
    return this.recommendationsService.recordImpressions(request.user.id, profileId, dto.recommendationIds);
  }
}