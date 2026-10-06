import {
  validatePeopleCommand,
  peopleMonotonicNow,
} from './private-people-protocol';
import { WorkerDeadline } from './private-people-worker-deadline';

const command = (end: number) => ({
  version: 1,
  sequence: 1,
  phase: 'dispose',
  remaining: 1000,
  monotonic_end: end,
  request_id: 'request',
  payload_sha256: 'digest',
});

describe('protected same-kernel IPC clock (controlled, no physical channel proof)', () => {
  beforeEach(() => jest.useRealTimers());
  afterEach(() => jest.useFakeTimers());
  it('rejects Proxy before any phase/plain-object descriptor traps', () => {
    const traps = jest.fn();
    const proxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          traps();
          return undefined;
        },
        getPrototypeOf: () => {
          traps();
          return Object.prototype;
        },
      },
    );
    expect(() => validatePeopleCommand(proxy)).toThrow();
    expect(traps).not.toHaveBeenCalled();
  });
  it('delayed delivery consumes the absolute budget rather than renewing receive time', () => {
    let now = 1000;
    const clock = jest
      .spyOn(process.hrtime, 'bigint')
      .mockImplementation(() => BigInt(now) * BigInt(1_000_000));
    try {
      const end = peopleMonotonicNow() + 150;
      now += 100;
      const received = validatePeopleCommand(command(end));
      const deadline = new WorkerDeadline(received.monotonic_end);
      expect(deadline.remaining()).toBeLessThan(100);
      expect(deadline.remaining()).toBe(50);
      deadline.close();
      expect(() =>
        validatePeopleCommand(command(peopleMonotonicNow() - 1)),
      ).toThrow();
    } finally {
      clock.mockRestore();
    }
  });
  it('earlier work or cleanup absolute end cannot be renewed by a later command', () => {
    const end = peopleMonotonicNow() + 100;
    const deadline = new WorkerDeadline(end);
    deadline.shrink(peopleMonotonicNow() + 1000);
    expect(deadline.remaining()).toBeLessThanOrEqual(100);
    deadline.shrink(peopleMonotonicNow() + 30);
    deadline.shrink(peopleMonotonicNow() + 500);
    expect(deadline.remaining()).toBeLessThanOrEqual(30);
    deadline.close();
  });
});
