import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateTitleStateDto } from './dto/update-title-state.dto';
import { UserTitleStateService } from './user-title-state.service';

@Controller('profiles/:profileId')
@UseGuards(AuthGuard('jwt'))
export class UserTitleStateController {
  constructor(private readonly userTitleStateService: UserTitleStateService) {}

  @Patch('titles/:titleId/state')
  upsert(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('titleId', ParseUUIDPipe) titleId: string,
    @Body() updateTitleStateDto: UpdateTitleStateDto,
  ) {
    return this.userTitleStateService.upsert(request.user.id, profileId, titleId, updateTitleStateDto);
  }

  @Get('watched-titles')
  findWatched(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.userTitleStateService.findByState(request.user.id, profileId, 'watched');
  }

  @Get('watchlist')
  findWatchlist(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.userTitleStateService.findByState(request.user.id, profileId, 'watchlist');
  }
}