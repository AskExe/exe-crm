// Stub: exe-os manages DNS externally
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class DomainValidRecords {
  @Field(() => [String], { nullable: true })
  // oxlint-disable-next-line @typescript/no-explicit-any
  records: any[];
}
