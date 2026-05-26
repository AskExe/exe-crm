// Stub: exe-os billing
import { Injectable } from '@nestjs/common';

export type UpdateSubscriptionQuantityJobData = {
  workspaceId: string;
};

@Injectable()
export class UpdateSubscriptionQuantityJob {
  async handle(_data: UpdateSubscriptionQuantityJobData): Promise<void> {
    // no-op: exe-os handles billing externally
  }
}
