import { type DataSource } from 'typeorm';

// Internal optional DI token. Ordinary application modules never provide it.
export const PRIVATE_PEOPLE_POOL_CUSTODY = Symbol(
  'private-people-pool-custody',
);
export interface PrivatePeoplePoolCustody {
  initialize(source: DataSource): Promise<DataSource>;
  close(source: DataSource): Promise<void>;
}
