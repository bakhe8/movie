import { Body, Controller, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import type { SafeUser } from '../auth/auth.service';
import { PublishTitleDto } from './dto/publish-title.dto';
import { PublishActor, PublishTitleService } from './publish-title.service';

type PublishRequest = { user: SafeUser; ip?: string };

function actorOf(request: PublishRequest): PublishActor {
  return { id: request.user.id, role: request.user.role, ip: request.ip ?? null };
}

// Board 1D-9: manual publish only -- one explicit call per title, no batch
// endpoint and no scheduler here. `PublishTitleService` is where the actual
// transaction/lock/readback contract lives; this controller only wires the
// HTTP shape and the actor.
@Controller('admin/publication')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class PublishTitleController {
  constructor(private readonly publishTitle: PublishTitleService) {}

  @Post('titles/:titleId/publish')
  publish(@Param('titleId', ParseUUIDPipe) titleId: string, @Body() dto: PublishTitleDto, @Request() request: PublishRequest) {
    return this.publishTitle.publish(titleId, dto.expectedRevision, actorOf(request));
  }
}
