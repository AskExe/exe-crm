import { type DataSourceOptions } from 'typeorm';

export const PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS = 250;
type FixedConnection = Readonly<{
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}>;

// Only used after the fixed protected connection parser. Return a private URL,
// never a credential-bearing receipt or an explicit-field connection overlay.
export const privatePeopleConnectionUrl = (
  connection: FixedConnection,
): string => {
  const url = new URL(
    'postgresql://' + connection.host + ':' + connection.port,
  );
  url.username = connection.username;
  url.password = connection.password;
  url.pathname = '/' + connection.database;
  return url.toString();
};
export const privatePeoplePoolBounds = (options: DataSourceOptions) => {
  if (options.type !== 'postgres')
    throw new Error('Private assembly pool type unavailable');
  return {
    type: 'postgres' as const,
    connectTimeoutMS: PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
    extra: {
      ...options.extra,
      connectionTimeoutMillis: PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
      statement_timeout: 1000,
    },
  };
};
