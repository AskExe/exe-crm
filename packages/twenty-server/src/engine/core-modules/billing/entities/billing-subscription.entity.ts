// Stub: exe-os billing — kept as TypeORM @Entity() so
// TypeOrmModule.forFeature([BillingSubscriptionEntity]) resolves at runtime
import { Field, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'billingSubscription', schema: 'core' })
@ObjectType()
export class BillingSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field()
  id: string;

  @Column({ nullable: true })
  @Field({ nullable: true })
  workspaceId?: string;

  @Column({ nullable: true })
  @Field({ nullable: true })
  status?: string;
}
