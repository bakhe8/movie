import { Body, Controller, Get, Headers, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RankTriadDto } from './dto/rank-triad.dto';
import { ReplaceTriadItemDto } from './dto/replace-triad-item.dto';
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

  // The two neutral replacement controls of the triad screen (blueprint
  // §4.3, ADR-17): swaps only the named item, logs why, never records a
  // preference. Returns the updated triad -- with `status: 'skipped'` when
  // nothing eligible was left to swap in, so the client should ask for the
  // current triad again.
  @Post('triads/:triadId/replace')
  replace(
    @Request() request: { user: { id: string } },
    @Param('triadId') triadId: string,
    @Body() replaceTriadItemDto: ReplaceTriadItemDto,
  ) {
    return this.triadsService.replace(request.user.id, triadId, replaceTriadItemDto);
  }
}
