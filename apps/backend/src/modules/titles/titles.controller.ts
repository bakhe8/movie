import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListTitlesQueryDto } from './dto/list-titles-query.dto';
import { TitlesService } from './titles.service';

@Controller('titles')
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