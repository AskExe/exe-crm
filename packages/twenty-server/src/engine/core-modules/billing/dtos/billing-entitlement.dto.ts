// Stub: exe-os billing
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class BillingEntitlementDTO {
  @Field()
  key: string;

  @Field()
  value: boolean;
}
