import { IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class RankTriadDto {
  @IsArray()
  @IsInt({ each: true })
  ranking: number[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sessionId?: string;
}