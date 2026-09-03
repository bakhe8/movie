import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainingService } from './training.service';

@Controller('profiles/:profileId')
@UseGuards(AuthGuard('jwt'))
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  // Explicit request; the automatic trigger needs no route.
  @Post('train')
  @HttpCode(202)
  train(@Request() request: { user: { id: string } }, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.trainingService.requestTraining(request.user.id, profileId);
  }

  @Get('training')
  status(@Request() request: { user: { id: string } }, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.trainingService.status(request.user.id, profileId);
  }
}
