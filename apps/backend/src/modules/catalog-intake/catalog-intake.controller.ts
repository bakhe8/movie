import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { PageQueryDto } from '../admin/dto/admin.dto';
import { CatalogIntakeService } from './catalog-intake.service';
import type { CatalogIntakeStatus } from '../../entities/catalog-intake.entity';

const STATUSES = ['discovered', 'verified', 'blocked', 'duplicate', 'admitted'] as const;

export class ListIntakeQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: CatalogIntakeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  blockerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}

// CAT-J1 (ADR-121): the intake queue, read-only, admin-gated like every
// other /admin route (AdminGuard after the JWT guard). No write lives here:
// pulls and re-verifies run as admin_jobs, admission is `catalog_admit`
// (refusing until PUB-G1 is confirmed), and a human resolves duplicates in
// the control center through an audited write that ADMIN-W5+ owns. This is
// the "queue of the incomplete" the board's D1000-3 asks the admin to show.
@Controller('admin/catalog-intake')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class CatalogIntakeController {
  constructor(private readonly intake: CatalogIntakeService) {}

  @Get()
  list(@Query() query: ListIntakeQueryDto) {
    return this.intake.list(query);
  }

  @Get('stats')
  stats() {
    return this.intake.stats();
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.intake.get(id);
    if (!row) throw new NotFoundException('Intake candidate not found');
    return row;
  }
}
