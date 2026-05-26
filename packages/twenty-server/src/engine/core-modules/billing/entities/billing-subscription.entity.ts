// Stub: exe-os billing
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class BillingSubscriptionEntity {
  @Field()
  id: string;
}
