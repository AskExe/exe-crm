import {
  ObjectRecordCreateEvent,
  ObjectRecordUpsertEvent,
} from 'twenty-shared/database-events';

// Preserve native event classes and PG Date values; do not invoke toJSON,
// getters or constructors supplied by a record. The queue never retains mutable
// record/cache aliases. This is event data, not authority or a transport parser.
export const capturePrivateInsertEvent = <T>(input: T): T => {
  let nodes = 0;
  let bytes = 0;
  const active = new Set<object>();
  const add = (count: number) => {
    bytes += count;
    if (bytes > 4194304) throw new Error('Private event bound unavailable');
  };
  const walk = (value: unknown, depth: number): unknown => {
    if (++nodes > 65536 || depth > 16)
      throw new Error('Private event bound unavailable');
    if (value === null || value === undefined || typeof value === 'boolean') {
      add(8);
      return value;
    }
    if (typeof value === 'string') {
      add(Buffer.byteLength(value) + 8);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      add(32);
      return value;
    }
    if (typeof value !== 'object')
      throw new Error('Private event data unavailable');
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Date.prototype && Reflect.ownKeys(value).length === 0) {
      const milliseconds = Date.prototype.getTime.call(value);
      if (!Number.isFinite(milliseconds))
        throw new Error('Private event date unavailable');
      add(32);
      return new Date(milliseconds);
    }
    if (
      active.has(value) ||
      ![
        Object.prototype,
        null,
        Array.prototype,
        ObjectRecordCreateEvent.prototype,
        ObjectRecordUpsertEvent.prototype,
      ].includes(prototype)
    )
      throw new Error('Private event data unavailable');
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const array = Array.isArray(value);
    if (array && prototype !== Array.prototype)
      throw new Error('Private event array unavailable');
    const output: Record<string, unknown> = array
      ? ([] as unknown as Record<string, unknown>)
      : Object.create(prototype);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = typeof key === 'string' ? descriptors[key] : undefined;
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))
      )
        throw new Error('Private event property unavailable');
      add(Buffer.byteLength(key) + 8);
      Object.defineProperty(output, key, {
        value: walk(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    if (array && Object.keys(output).length !== value.length)
      throw new Error('Private event sparse array unavailable');
    active.delete(value);
    return output;
  };
  return walk(input, 0) as T;
};
