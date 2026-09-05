import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

// ADR-110: the ids the client actually rendered. Bounded by the largest
// list this API will return for one request (limit <= 50), so a caller
// cannot stamp an unbounded set of rows in one call.
export class RecordImpressionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  recommendationIds: string[];
}
