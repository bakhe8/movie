import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ResetTasteDto, ReverifyDto } from './dto/privacy.dto';
import { PrivacyService } from './privacy.service';

type AuthedRequest = { user: { id: string }; ip?: string };

// API.md §2.2's /privacy/* rights endpoints, kept under the unversioned /api
// prefix for the same reason ConsentsController is (ADR-15: the /api/v1 move
// happens in one step). User-scoped: an account owns its data, profiles are
// named inside the body where one is meant.
@Controller('privacy')
@UseGuards(AuthGuard('jwt'))
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get('requests')
  list(@Request() request: AuthedRequest) {
    return this.privacyService.listRequests(request.user.id);
  }

  // Returns the portable copy itself (JSON) -- see PrivacyService for why
  // this is synchronous at Alpha scale.
  @Post('export')
  @HttpCode(200)
  export(@Request() request: AuthedRequest, @Body() body: ReverifyDto) {
    return this.privacyService.export(request.user.id, body.password, request.ip ?? null);
  }

  @Post('delete')
  @HttpCode(202)
  requestDelete(@Request() request: AuthedRequest, @Body() body: ReverifyDto) {
    return this.privacyService.requestDelete(request.user.id, body.password, request.ip ?? null);
  }

  @Post('delete/:requestId/cancel')
  @HttpCode(200)
  cancelDelete(@Request() request: AuthedRequest, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.privacyService.cancelDelete(request.user.id, requestId, request.ip ?? null);
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Request() request: AuthedRequest, @Body() body: ResetTasteDto) {
    return this.privacyService.reset(request.user.id, body.profileId, request.ip ?? null);
  }
}
