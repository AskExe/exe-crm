import { HttpException } from '@nestjs/common';

import { type I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import {
  BaseGraphQLError,
  ErrorCode,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { convertExceptionToGraphQLError } from 'src/engine/utils/global-exception-handler.util';
import { CustomException } from 'src/utils/custom-exception';

export const generateGraphQLErrorFromError = (
  error: Error | CustomException,
  i18n: I18n,
) => {
  // In production, don't leak internal error messages (DB constraints, stack details)
  // to the client. Use a generic message for non-HTTP, non-Custom exceptions.
  const isProduction = process.env.NODE_ENV === 'production';
  const safeMessage =
    isProduction && !(error instanceof HttpException) && !(error instanceof CustomException)
      ? 'Internal server error'
      : error.message;

  const graphqlError =
    error instanceof HttpException
      ? convertExceptionToGraphQLError(error)
      : new BaseGraphQLError(safeMessage, ErrorCode.INTERNAL_SERVER_ERROR);

  const defaultErrorMessage = msg`An error occurred.`;

  if (error instanceof CustomException) {
    graphqlError.extensions.userFriendlyMessage = i18n._(
      error.userFriendlyMessage ?? defaultErrorMessage,
    );
  } else {
    graphqlError.extensions.userFriendlyMessage = i18n._(defaultErrorMessage);
  }

  return graphqlError;
};
