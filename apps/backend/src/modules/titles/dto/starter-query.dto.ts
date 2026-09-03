import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StarterQueryDto {
  // How many diverse titles to suggest to a user who has marked nothing yet
  // (blueprint §4.2). Small on purpose: the start must not become a long
  // data-entry task.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit = 12;
}
