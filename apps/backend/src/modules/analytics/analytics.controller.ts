import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { RecordEventDto } from './dto/record-event.dto';
import { AnalyticsService } from './analytics.service';

// ALPHA_PLAN 7.5. The client reports only what the server cannot see for
// itself: which onboarding step a person reached, and when a card was opened.
// Everything measurable server-side (a triad answered, a watch marked) is
// recorded by the service that already handles it, so it cannot be inflated
// or withheld by a client.
@Controller('profiles/:profileId/analytics/events')
@UseGuards(AuthGuard('jwt'))
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
  ) {}

  // 202, not 201: nothing is returned and the event may legitimately be
  // dropped -- the profile has not consented, or the properties were not
  // usable. Telling a client which of those happened would leak the consent
  // state to anything that can call this.
  @Post()
  @HttpCode(202)
  async record(
    @Request() request: { user: { id: string } },
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: RecordEventDto,
  ): Promise<void> {
    // Ownership is checked here rather than in the service: an unowned
    // profile id must not become a way to write rows onto someone else's
    // funnel, and the answer is the same either way (202) so it is not an
    // existence oracle.
    const profile = await this.profilesRepository.findOne({
      where: { id: profileId, userId: request.user.id },
      select: { id: true },
    });
    if (!profile) {
      return;
    }
    await this.analyticsService.record(
      profileId,
      dto.name,
      dto.properties ?? {},
      dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    );
  }
}
