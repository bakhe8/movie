import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateConsentsDto } from './dto/update-consents.dto';
import { ConsentsService } from './consents.service';

// User-scoped, not profile-scoped: consents.userId is what SCHEMA.md's target
// DDL specifies (M2) -- terms_privacy is asked at registration, before any
// profile exists (PRIVACY.md §3), so purpose consent can't be profile-scoped
// for that purpose at least. Matches API.md §2.2's GET/PUT /consents, kept
// under the unversioned /api prefix rather than /api/v1: ADR-15 commits the
// whole API to migrate to /api/v1 in one step when the first v1 endpoint
// ships, which this single feature is not the moment for.
@Controller('consents')
@UseGuards(AuthGuard('jwt'))
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Get()
  findForUser(@Request() request: { user: { id: string } }) {
    return this.consentsService.findForUser(request.user.id);
  }

  @Put()
  update(@Request() request: { user: { id: string } }, @Body() updateConsentsDto: UpdateConsentsDto) {
    return this.consentsService.update(request.user.id, updateConsentsDto.consents);
  }
}
