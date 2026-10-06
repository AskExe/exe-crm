import { types } from 'node:util';

import { type PrivatePeopleSource } from './private-people-contract';

export const PEOPLE_WORKER =
  '/app/packages/twenty-server/dist/engine/core-modules/company-people/private-people-worker.entry.js';
export const PEOPLE_NODE = '/usr/local/bin/node';
// Same-kernel internal process IPC only, never a public/Core authority clock.
export const peopleMonotonicNow = () => Number(process.hrtime.bigint()) / 1e6;
export const PEOPLE_LOG_LIMIT = 65536;
export const PEOPLE_PHASES = [
  'prepare',
  'commit',
  'rollback',
  'dispose',
  'publish',
] as const;
export type PeoplePhase = (typeof PEOPLE_PHASES)[number];
export type PeopleCommand = {
  version: 1;
  sequence: number;
  phase: PeoplePhase;
  remaining: number;
  monotonic_end: number;
  request_id: string;
  payload_sha256: string;
  source?: PrivatePeopleSource;
  payload?: string;
};
export type PeopleReply = {
  version: 1;
  sequence: number;
  phase: PeoplePhase;
  request_id: string;
  payload_sha256: string;
  outcome: 'ok' | 'uncertain';
  ids: string[] | null;
};

export const closedPeopleMessage = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> => {
  if (
    !value ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(descriptors).length === keys.length &&
    keys.every(
      (key) => descriptors[key]?.enumerable && 'value' in descriptors[key],
    )
  );
};
export const validatePeopleCommand = (value: unknown): PeopleCommand => {
  if (
    !value ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error('Private people channel unavailable');
  const base = [
    'version',
    'sequence',
    'phase',
    'remaining',
    'monotonic_end',
    'request_id',
    'payload_sha256',
  ];
  const prepare =
    typeof value === 'object' &&
    value !== null &&
    Object.getOwnPropertyDescriptor(value, 'phase')?.value === 'prepare';
  if (
    !closedPeopleMessage(
      value,
      prepare ? [...base, 'source', 'payload'] : base,
    ) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !PEOPLE_PHASES.includes(value.phase as PeoplePhase) ||
    !Number.isInteger(value.remaining) ||
    Number(value.remaining) < 1 ||
    Number(value.remaining) > 60000 ||
    typeof value.monotonic_end !== 'number' ||
    !Number.isFinite(value.monotonic_end) ||
    value.monotonic_end <= peopleMonotonicNow() ||
    value.monotonic_end - peopleMonotonicNow() > Number(value.remaining) ||
    typeof value.request_id !== 'string' ||
    typeof value.payload_sha256 !== 'string' ||
    (prepare &&
      (typeof value.payload !== 'string' || value.payload.length > 349528))
  )
    throw new Error('Private people channel unavailable');
  return value as PeopleCommand;
};
