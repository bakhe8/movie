import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { PublicationPreviewService } from './publication-preview.service';

// PUB-S1 (ADR-118): admin-only, read-only preview of what policy `public-v1`
// would decide today. No route here writes `title_revisions` or
// `titles.publishedRevisionId`, and no public surface reads this
// controller -- it exists solely so ADMIN-W3..W5 (Z2) can later render the
// same numbers this returns.
@Controller('admin/publication')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class PublicationPreviewController {
  constructor(private readonly preview: PublicationPreviewService) {}

  @Get('readiness')
  readiness() {
    return this.preview.shadowReport();
  }
}
