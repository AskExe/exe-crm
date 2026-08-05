import { Field, HideField, InputType } from '@nestjs/graphql';

import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class CreateRoleInput {
  @IsUUID()
  @IsOptional()
  @Field({ nullable: true })
  id?: string;

  @HideField()
  universalIdentifier?: string;

  /**
   * System-owned roles are created with `isEditable: false` so they cannot be
   * mutated or deleted through the normal (non-system) migration path. Hidden
   * from the GraphQL API — only trusted server-side callers may set it.
   * Defaults to `true` (an ordinary, user-editable custom role).
   */
  @HideField()
  isEditable?: boolean;

  @IsString()
  @Field({ nullable: false })
  label: string;

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  description?: string;

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  icon?: string;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canUpdateAllSettings?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canAccessAllTools?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canReadAllObjectRecords?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canUpdateAllObjectRecords?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canSoftDeleteAllObjectRecords?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canDestroyAllObjectRecords?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canBeAssignedToUsers?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canBeAssignedToAgents?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  canBeAssignedToApiKeys?: boolean;
}
