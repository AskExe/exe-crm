// Stub: exe-os usage metering
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UsageBreakdownItemDTO {
  @Field()
  key: string;

  @Field({ nullable: true })
  label?: string;

  @Field()
  value: number;
}
