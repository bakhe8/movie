import { Body, Controller, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateWatchEventDto } from './dto/create-watch-event.dto';
import { WatchEventsService } from './watch-events.service';

@Controller('profiles/:profileId/watch-events')
@UseGuards(AuthGuard('jwt'))
export class WatchEventsController {
  constructor(private readonly watchEventsService: WatchEventsService) {}

  @Post()
  create(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() createWatchEventDto: CreateWatchEventDto,
  ) {
    return this.watchEventsService.create(request.user.id, profileId, createWatchEventDto);
  }
}
