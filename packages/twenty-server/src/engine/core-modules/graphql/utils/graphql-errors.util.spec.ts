import { GraphQLError } from 'graphql';

import {
  BaseGraphQLError,
  convertGraphQLErrorToBaseGraphQLError,
  ErrorCode,
} from 'src/engine/core-modules/graphql/utils/graphql-errors.util';

describe('convertGraphQLErrorToBaseGraphQLError', () => {
  it.each([
    [400, ErrorCode.BAD_USER_INPUT],
    [401, ErrorCode.UNAUTHENTICATED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [405, ErrorCode.METHOD_NOT_ALLOWED],
    [408, ErrorCode.TIMEOUT],
    [504, ErrorCode.TIMEOUT],
    [409, ErrorCode.CONFLICT],
    [422, ErrorCode.BAD_USER_INPUT],
    [500, ErrorCode.INTERNAL_SERVER_ERROR],
    [503, ErrorCode.INTERNAL_SERVER_ERROR],
  ])('should convert HTTP status %i to %s', (status, code) => {
    const error = new GraphQLError('Request refused', {
      extensions: { http: { status }, traceId: 'trace-123' },
    });

    const converted = convertGraphQLErrorToBaseGraphQLError(error);

    expect(converted).toBeInstanceOf(BaseGraphQLError);
    expect(converted.toJSON()).toEqual({
      message: 'Request refused',
      extensions: { http: { status }, traceId: 'trace-123', code },
    });
  });

  it.each([
    undefined,
    null,
    'http',
    401,
    true,
    {},
    { status: '401' },
    { status: null },
    { status: 0 },
    { status: 200 },
    { status: Number.NaN },
  ])(
    'should preserve unknown HTTP metadata %p with a server-error fallback',
    (http) => {
      const error = new GraphQLError('Unclassified error', {
        extensions: { traceId: 'trace-456' },
      });

      // Foreign error metadata need not conform to Yoga's HTTP declaration.
      Object.assign(error.extensions, { http });

      expect(convertGraphQLErrorToBaseGraphQLError(error).toJSON()).toEqual({
        message: 'Unclassified error',
        extensions: {
          http,
          traceId: 'trace-456',
          code: ErrorCode.INTERNAL_SERVER_ERROR,
        },
      });
    },
  );

  it('should convert an error without HTTP extensions to a server error', () => {
    const error = new GraphQLError('Unclassified error');

    expect(convertGraphQLErrorToBaseGraphQLError(error).toJSON()).toEqual({
      message: 'Unclassified error',
      extensions: { code: ErrorCode.INTERNAL_SERVER_ERROR },
    });
  });
});
