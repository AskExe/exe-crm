// Stub: exe-os usage metering
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UsageBreakdownItemDTO {
  @Field()
  label: string;

  @Field()
  value: number;
}
