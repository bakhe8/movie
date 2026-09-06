import { IsOptional, IsUUID } from 'class-validator';

// board 1D-9: the caller states which revision it believes is currently
// published (null = "I believe this title has never been published").
// Omitting the field entirely means the same as null -- a caller that
// truly doesn't know the current state should read it first, never guess.
export class PublishTitleDto {
  @IsOptional()
  @IsUUID()
  expectedRevision?: string | null;
}
