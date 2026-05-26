// Stub: exe-os billing
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class BillingSubscriptionEntity {
  @Field()
  id: string;

  @Field({ nullable: true })
  workspaceId?: string;

  @Field({ nullable: true })
  status?: string;
}
