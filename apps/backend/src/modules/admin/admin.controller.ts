import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import type { SafeUser } from '../auth/auth.service';
import { Actor, AdminCatalogService } from './admin-catalog.service';
import { AdminMetricsService } from './admin-metrics.service';
import { AdminModelsService } from './admin-models.service';
import { AdminOpsService } from './admin-ops.service';
import {
  CreateModelVersionDto,
  CreateSourceRecordDto,
  LatestTriadsQueryDto,
  ListAuditLogQueryDto,
  ListContentFeaturesQueryDto,
  ListPrivacyRequestsQueryDto,
  ListTitlesQueryDto,
  ListUsersQueryDto,
  MetricsQueryDto,
  ReviewContentFeatureDto,
  SampleContentFeaturesQueryDto,
  UpdateModelVersionDto,
  UpdateSourceRecordDto,
  UpdateTitleDto,
  UpdateUserDto,
} from './dto/admin.dto';

type AdminRequest = { user: SafeUser; ip?: string };

function actorOf(request: AdminRequest): Actor {
  return { id: request.user.id, role: request.user.role, ip: request.ip ?? null };
}

// The internal board's API (BP §5.1, §17.2; SPECIFICATION §5.5; API.md
// §2.2 `admin/**`). Role-gated by AdminGuard after the JWT guard; every
// write is audited by the services. Kept under /api like every other route
// until the /api/v1 move (ADR-15).
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly models: AdminModelsService,
    private readonly ops: AdminOpsService,
    private readonly metrics: AdminMetricsService,
  ) {}

  // ---- catalog and rights ------------------------------------------------

  @Get('titles')
  listTitles(@Query() query: ListTitlesQueryDto) {
    return this.catalog.listTitles(query);
  }

  @Get('titles/missing-fingerprints')
  missingFingerprints(@Query() query: ListTitlesQueryDto) {
    return this.catalog.missingFingerprints(query);
  }

  @Get('titles/:titleId')
  getTitle(@Param('titleId', ParseUUIDPipe) titleId: string) {
    return this.catalog.getTitle(titleId);
  }

  @Get('titles/:titleId/provenance')
  provenance(@Param('titleId', ParseUUIDPipe) titleId: string) {
    return this.catalog.provenance(titleId);
  }

  @Patch('titles/:titleId')
  updateTitle(@Request() request: AdminRequest, @Param('titleId', ParseUUIDPipe) titleId: string, @Body() dto: UpdateTitleDto) {
    return this.catalog.updateTitle(titleId, dto, actorOf(request));
  }

  @Post('titles/:titleId/source-records')
  addSourceRecord(
    @Request() request: AdminRequest,
    @Param('titleId', ParseUUIDPipe) titleId: string,
    @Body() dto: CreateSourceRecordDto,
  ) {
    return this.catalog.addSourceRecord(titleId, dto, actorOf(request));
  }

  @Patch('source-records/:recordId')
  updateSourceRecord(
    @Request() request: AdminRequest,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdateSourceRecordDto,
  ) {
    return this.catalog.updateSourceRecord(recordId, dto, actorOf(request));
  }

  // ---- fingerprint review queue -----------------------------------------

  @Get('content-features')
  listContentFeatures(@Query() query: ListContentFeaturesQueryDto) {
    return this.catalog.listContentFeatures(query);
  }

  @Get('content-features/sample')
  sampleContentFeatures(@Query() query: SampleContentFeaturesQueryDto) {
    return this.catalog.sampleContentFeatures(query);
  }

  @Post('content-features/:featureId/review')
  reviewContentFeature(
    @Request() request: AdminRequest,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() dto: ReviewContentFeatureDto,
  ) {
    return this.catalog.reviewContentFeature(featureId, dto, actorOf(request));
  }

  // ---- models, experiments, events ---------------------------------------

  @Get('models')
  listModels() {
    return this.models.listModels();
  }

  @Post('models')
  registerModel(@Request() request: AdminRequest, @Body() dto: CreateModelVersionDto) {
    return this.models.registerModel(dto, actorOf(request));
  }

  @Patch('models/:version')
  updateModel(@Request() request: AdminRequest, @Param('version') version: string, @Body() dto: UpdateModelVersionDto) {
    return this.models.updateModel(version, dto, actorOf(request));
  }

  @Get('experiments')
  listExperiments() {
    return this.models.listExperiments();
  }

  @Get('triads/latest')
  latestTriads(@Query() query: LatestTriadsQueryDto) {
    return this.models.latestTriads(query.limit);
  }

  // ---- accounts, privacy queue, audit log --------------------------------

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.ops.listUsers(query);
  }

  @Patch('users/:userId')
  updateUser(@Request() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateUserDto) {
    return this.ops.updateUser(userId, dto, actorOf(request));
  }

  @Get('privacy-requests')
  listPrivacyRequests(@Query() query: ListPrivacyRequestsQueryDto) {
    return this.ops.listPrivacyRequests(query);
  }

  @Get('audit-log')
  listAuditLog(@Query() query: ListAuditLogQueryDto) {
    return this.ops.listAuditLog(query);
  }

  // ---- metrics board (BP §18.1) -----------------------------------------

  @Get('metrics')
  metricsReport(@Query() query: MetricsQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - query.days * 86_400_000);
    return this.metrics.report({ from, to, excludeDomains: query.excludeDomains });
  }
}
