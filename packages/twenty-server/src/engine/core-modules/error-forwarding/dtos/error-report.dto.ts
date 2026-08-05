import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Validation DTO for POST /api/errors. Intentionally permissive: the only
// hard requirement is a string `message`; every other field is optional and
// only type-checked when present. This preserves the existing exe-monitor /
// twenty-front error-forwarding contract (errorReporter.ts) while rejecting
// malformed payloads (e.g. non-string message, wrong-typed fields).
export class ErrorReportDto {
  @IsString()
  @MaxLength(10_000)
  message: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsIn(['error', 'fatal', 'warn'])
  level?: 'error' | 'fatal' | 'warn';

  @IsOptional()
  @IsIn(['frontend', 'backend'])
  type?: 'frontend' | 'backend';

  // stack may legitimately be null (frontend sends `error.stack ?? null`).
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  stack?: string | null;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsInt()
  status_code?: number;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  release?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
