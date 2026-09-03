import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(AuthGuard('jwt'))
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post()
  create(@Request() request: { user: { id: string } }, @Body() createProfileDto: CreateProfileDto) {
    return this.profilesService.create(request.user.id, createProfileDto);
  }

  @Get()
  findAll(@Request() request: { user: { id: string } }) {
    return this.profilesService.findAll(request.user.id);
  }

  @Get(':profileId')
  findOne(@Request() request: { user: { id: string } }, @Param('profileId') profileId: string) {
    return this.profilesService.findOne(request.user.id, profileId);
  }

  @Patch(':profileId')
  update(
    @Request() request: { user: { id: string } },
    @Param('profileId') profileId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.update(request.user.id, profileId, updateProfileDto);
  }

  @Delete(':profileId')
  @HttpCode(204)
  async remove(@Request() request: { user: { id: string } }, @Param('profileId') profileId: string) {
    await this.profilesService.remove(request.user.id, profileId);
  }
}