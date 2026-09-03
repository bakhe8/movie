import { Body, Controller, Get, Headers, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RankTriadDto } from './dto/rank-triad.dto';
import { TriadsService } from './triads.service';

@UseGuards(AuthGuard('jwt'))
@Controller()
export class TriadsController {
  constructor(private readonly triadsService: TriadsService) {}

  @Get('profiles/:profileId/triads/current')
  getCurrent(
    @Request() request: { user: { id: string } },
    @Param('profileId') profileId: string,
  ) {
    return this.triadsService.getCurrent(request.user.id, profileId);
  }

  @Get('profiles/:profileId/triads')
  findCompleted(
    @Request() request: { user: { id: string } },
    @Param('profileId') profileId: string,
  ) {
    return this.triadsService.findCompleted(request.user.id, profileId);
  }

  @Post('triads/:triadId/rank')
  rank(
    @Request() request: { user: { id: string } },
    @Param('triadId') triadId: string,
    @Body() rankTriadDto: RankTriadDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.triadsService.rank(request.user.id, triadId, rankTriadDto, idempotencyKey);
  }
}
