import { Body, Controller, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateOutcomeDto } from './dto/create-outcome.dto';
import { OutcomesService } from './outcomes.service';

// No profileId in the path -- ownership comes from the recommendation's own
// profileId, the same pattern POST /triads/:triadId/rank uses.
@Controller('recommendations/:recommendationId/outcome')
@UseGuards(AuthGuard('jwt'))
export class OutcomesController {
  constructor(private readonly outcomesService: OutcomesService) {}

  @Post()
  create(
    @Request() request: { user: { id: string } },
    @Param('recommendationId', ParseUUIDPipe) recommendationId: string,
    @Body() createOutcomeDto: CreateOutcomeDto,
  ) {
    return this.outcomesService.create(request.user.id, recommendationId, createOutcomeDto);
  }
}
