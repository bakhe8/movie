import { IsIn, IsISO8601, IsObject, IsOptional } from 'class-validator';
import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from '../../../entities/analytics-event.entity';
import type { AnalyticsProperties } from '../analytics.service';

export class RecordEventDto {
  // The closed list, enforced at the edge: a client cannot invent an event
  // name, so the table stays a set of known counters rather than whatever a
  // future screen decided to send.
  @IsIn(ANALYTICS_EVENT_NAMES as unknown as string[])
  name: AnalyticsEventName;

  // Shape only. AnalyticsService drops every value that is not a number, a
  // boolean or a short tag -- validating that here as well would duplicate
  // the one place that must not be bypassed.
  @IsOptional()
  @IsObject()
  properties?: AnalyticsProperties;

  // A round finished offline is stamped when it happened, not when it
  // arrived. Trusted only as far as the service's own clamp allows.
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
