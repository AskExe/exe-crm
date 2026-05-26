import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

import { Type } from 'class-transformer';

export class IngestRecordDto {
  @IsString()
  @IsNotEmpty()
  objectName: string;

  @IsNotEmpty()
  fields: Record<string, any>;

  @IsOptional()
  @IsString()
  rawEventId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deduplicateOn?: string[];
}

export class IngestDataDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestRecordDto)
  records: IngestRecordDto[];

  @IsString()
  @IsNotEmpty()
  source: string;
}

export type IngestError = {
  index: number;
  objectName: string;
  message: string;
  rawEventId?: string;
};

export type IngestResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: IngestError[];
};
