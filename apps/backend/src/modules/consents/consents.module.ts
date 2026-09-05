import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consent } from '../../entities/consent.entity';
import { Profile } from '../../entities/profile.entity';
import { User } from '../../entities/user.entity';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

@Module({
  imports: [TypeOrmModule.forFeature([Consent, Profile, User])],
  controllers: [ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
