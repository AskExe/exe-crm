import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type MessageWithParticipants } from 'src/modules/messaging/message-import-manager/types/message';
import { getDomainNameByEmail } from 'src/utils/get-domain-name-by-email';

const logger = new Logger('filterOutInternals');

export const filterOutInternals = (
  primaryHandle: string,
  messages: MessageWithParticipants[],
) => {
  return messages.filter((message) => {
    if (!message.participants) {
      return true;
    }

    const primaryHandleDomain = getDomainNameByEmail(primaryHandle);

    try {
      const isAllHandlesFromSameDomain = message.participants
        .filter((participant) => isDefined(participant.handle))
        .every(
          (participant) =>
            isDefined(participant.handle) &&
            getDomainNameByEmail(participant.handle) === primaryHandleDomain,
        );

      if (isAllHandlesFromSameDomain) {
        return false;
      }
    } catch (error) {
      // Keep the message (don't filter) but surface the failure — a swallowed
      // error here silently mis-filters WhatsApp/email participants.
      logger.warn(
        `filterOutInternals: domain comparison failed, keeping message: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return true;
    }

    return true;
  });
};
