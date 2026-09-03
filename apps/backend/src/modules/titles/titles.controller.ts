import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { TitlesService } from './titles.service';

// M2: the catalog (including its now-stripped fingerprint/externalIds -- see
// TitlesService) was reachable by anyone, with only the global 60 req/min
// throttle standing between a scraper and the whole thing. The only client
// is this app, and every screen that reads titles already has a token by
// the time it renders (behind SessionProvider), so this has no effect on it.
@Controller('titles')
@UseGuards(AuthGuard('jwt'))
export class TitlesController {
  constructor(private readonly titlesService: TitlesService) {}

  @Get()
  findAll(@Query() query: ListTitlesQueryDto) {
    return this.titlesService.findAll(query);
  }

  @Get('search')
  search(@Query() query: ListTitlesQueryDto) {
    return this.titlesService.findAll(query);
  }

  @Get(':titleId')
  findOne(@Param('titleId', ParseUUIDPipe) titleId: string) {
    return this.titlesService.findOne(titleId);
  }
}