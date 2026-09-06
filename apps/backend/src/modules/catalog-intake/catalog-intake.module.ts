import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogIntake } from '../../entities/catalog-intake.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { AdminModule } from '../admin/admin.module';
import { CatalogIntakeController } from './catalog-intake.controller';
import { CatalogIntakeService } from './catalog-intake.service';
import { CatalogJobsService } from './catalog-jobs.service';
import { CatalogPullScheduleService } from './catalog-pull-schedule.service';
import { WikidataSource } from './sources/wikidata.source';

// CAT-J1 (ADR-121): the catalog intake path -- `catalog_intake` and its
// read-only admin queue, the J1 job types registered into ADMIN-W5's job
// center, the Wikidata source adapter, and the periodic trigger. Imports
// AdminModule only so the job center initialises first; the registration
// itself goes through ModuleRef so this module never edits an ADMIN file.
// `Title` and `SourceRecord` are read here, never written: admission
// (`catalog_admit`) refuses until PUB-G1 is confirmed live and authorised.
@Module({
  imports: [TypeOrmModule.forFeature([CatalogIntake, Title, SourceRecord]), AdminModule],
  controllers: [CatalogIntakeController],
  providers: [
    { provide: WikidataSource, useFactory: () => new WikidataSource() },
    CatalogIntakeService,
    CatalogJobsService,
    CatalogPullScheduleService,
  ],
  exports: [CatalogIntakeService],
})
export class CatalogIntakeModule {}
