// Stub: exe-os billing
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class BillingTrialPeriodDTO {
  @Field({ nullable: true })
  duration?: number;

  @Field({ nullable: true })
  isTrial?: boolean;

  @Field({ nullable: true })
  isCreditCardRequired?: boolean;
}
