import {
  PrivatePeopleIOCustody,
  PrivatePeopleContextCustody,
  PrivatePeopleAssemblySettlement,
} from './private-people-assembly-lifecycle';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('private assembly owned IO (controlled, no connection/context import)', () => {
  let now = 1000;
  const end = (value: number) => ({
    signal: new AbortController().signal,
    remaining: () => value - now,
  });
  beforeEach(() => {
    now = 1000;
    jest
      .spyOn(process.hrtime, 'bigint')
      .mockImplementation(() => BigInt(now) * BigInt(1_000_000));
  });
  afterEach(() => jest.restoreAllMocks());

  it('retains resource before invoking asynchronous acquisition', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const acquire = jest.fn(async () => 'ready');
    const close = jest.fn(async () => undefined);
    const resource = {};
    const pending = custody.own(resource, acquire, close);
    expect(acquire).not.toHaveBeenCalled();
    expect(await pending).toBe('ready');
    await custody.dispose(end(1900));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('manual disposal and native shutdown share the exact close promise', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const resource = {};
    const close = jest.fn(async () => undefined);
    await custody.own(resource, async () => undefined, close);
    const first = custody.close(resource);
    expect(custody.close(resource)).toBe(first);
    await first;
    await custody.dispose(end(1900));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('waits for pending acquisition before closing and never returns early success', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const gate = deferred<void>();
    const close = jest.fn(async () => undefined);
    const pending = custody.own({}, () => gate.promise, close);
    await Promise.resolve();
    const preparing = pending.catch((error: unknown) => error);
    let settled = false;
    const disposing = custody
      .dispose(end(1900))
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    gate.resolve();
    await preparing;
    await disposing;
    expect(close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
  });
  it('quarantines a genuinely late acquisition without invoking expired release', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(1100));
    const gate = deferred<void>();
    const close = jest.fn(async () => undefined);
    const pending = custody
      .own({}, () => gate.promise, close)
      .catch((error: unknown) => error);
    await Promise.resolve();
    const disposing = custody
      .dispose(end(1090))
      .catch((error: unknown) => error);
    now = 1200;
    gate.resolve();
    const first = await pending;
    const failure = await disposing;
    expect(first).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(Error);
    expect(close).not.toHaveBeenCalled(); // No physical cancellation/release proof.
  });
  it('earlier cleanup followed by longer cleanup cannot renew the original end', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    await custody.own(
      {},
      async () => undefined,
      async () => undefined,
    );
    await custody.dispose(end(1200));
    now = 1300;
    expect(() => custody.dispose(end(1900))).toThrow('closure unproved');
    expect(() => custody.assertCurrent()).toThrow('original end');
  });
  it('abort after a valid acquisition but before continuation remains sticky', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const gate = deferred<void>();
    const pending = custody.own(
      {},
      () => gate.promise,
      async () => undefined,
    );
    await Promise.resolve();
    const fatal = new Error('disconnect');
    gate.resolve();
    custody.abort(fatal);
    await expect(pending).rejects.toBe(fatal);
    await expect(custody.dispose(end(1900))).rejects.toBe(fatal);
  });
  it('refuses any new acquisition once disposal starts', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    await custody.dispose(end(1900));
    const acquire = jest.fn(async () => undefined);
    expect(() => custody.own({}, acquire, async () => undefined)).toThrow(
      'reuse',
    );
    expect(acquire).not.toHaveBeenCalled();
  });
  it('never retries failed close and preserves the original fatal before cleanup failure', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const secondary = new Error('quit failed');
    const close = jest.fn(async () => {
      throw secondary;
    });
    await custody.own({}, async () => undefined, close);
    const primary = new Error('capture fatal');
    custody.abort(primary);
    const first = custody.dispose(end(1900));
    const error = await first.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(PrivatePeopleAssemblySettlement);
    expect((error as PrivatePeopleAssemblySettlement).primary).toBe(primary);
    expect((error as PrivatePeopleAssemblySettlement).secondary).toEqual([
      secondary,
    ]);
    await expect(custody.dispose(end(1800))).rejects.toBe(error);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('failed acquisition becomes sticky and cannot acknowledge clean disposal', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const failure = new Error('initialize failed');
    const close = jest.fn(async () => undefined);
    await expect(
      custody.own(
        {},
        async () => {
          throw failure;
        },
        close,
      ),
    ).rejects.toBe(failure);
    await expect(custody.dispose(end(1900))).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('an abort signal refuses a later otherwise-valid acquisition result', async () => {
    const custody = new PrivatePeopleIOCustody();
    const controller = new AbortController();
    custody.admit({ signal: controller.signal, remaining: () => 1000 });
    const gate = deferred<void>();
    const pending = custody.own(
      {},
      () => gate.promise,
      async () => undefined,
    );
    await Promise.resolve();
    controller.abort();
    gate.resolve();
    await expect(pending).rejects.toThrow('aborted');
  });
  it('duplicate resource identity refuses a second initialization', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const resource = {};
    await custody.own(
      resource,
      async () => undefined,
      async () => undefined,
    );
    const again = jest.fn(async () => undefined);
    expect(() => custody.own(resource, again, async () => undefined)).toThrow(
      'reuse',
    );
    expect(again).not.toHaveBeenCalled();
    await custody.dispose(end(1900));
  });
  it('cached close cannot turn expired final settlement into success', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(1200));
    const resource = {};
    const close = jest.fn(async () => undefined);
    await custody.own(resource, async () => undefined, close);
    await custody.close(resource);
    now = 1200;
    expect(() => custody.close(resource)).toThrow('closure unproved');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('connected partial-preparation refusal closes known IO and context despite sticky fatal', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const contexts = new PrivatePeopleContextCustody(custody);
    const ioClose = jest.fn(async () => undefined);
    const contextClose = jest.fn(async () => undefined);
    const listeners = { removeAllListeners: jest.fn() };
    await custody.own({}, async () => undefined, ioClose);
    contexts.retain(Promise.resolve({ close: contextClose }));
    contexts.retainListeners(listeners);
    const primary = new Error('prepare failed');
    custody.abort(primary);
    await expect(custody.settleKnownIO()).rejects.toBe(primary);
    await contexts.close();
    expect(ioClose).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(listeners.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(() => custody.assertCurrent()).toThrow(primary);
  });
  it('late context within the admitted refusal end is owned and closed exactly once', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const contexts = new PrivatePeopleContextCustody(custody);
    const gate = deferred<{ close(): Promise<void> }>();
    const close = jest.fn(async () => undefined);
    contexts.retain(gate.promise);
    custody.abort(new Error('disconnect'));
    const first = contexts.close();
    expect(contexts.close()).toBe(first);
    expect(close).not.toHaveBeenCalled();
    gate.resolve({ close });
    await first;
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('expired refused context remains unproved and does not invoke late close', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(1100));
    const contexts = new PrivatePeopleContextCustody(custody);
    const gate = deferred<{ close(): Promise<void> }>();
    const close = jest.fn(async () => undefined);
    contexts.retain(gate.promise);
    const closing = contexts.close();
    now = 1200;
    gate.resolve({ close });
    await expect(closing).rejects.toBeInstanceOf(Error);
    expect(close).not.toHaveBeenCalled();
  });
  it('context close primary precedes a simultaneous listener cleanup failure', async () => {
    const custody = new PrivatePeopleIOCustody();
    custody.admit(end(2000));
    const contexts = new PrivatePeopleContextCustody(custody);
    const primary = new Error('close failed');
    const secondary = new Error('listener failed');
    contexts.retain(
      Promise.resolve({
        close: async () => {
          throw primary;
        },
      }),
    );
    contexts.retainListeners({
      removeAllListeners: () => {
        throw secondary;
      },
    });
    const failure = await contexts.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivatePeopleAssemblySettlement);
    expect((failure as PrivatePeopleAssemblySettlement).primary).toBe(primary);
    expect((failure as PrivatePeopleAssemblySettlement).secondary).toEqual([
      secondary,
    ]);
  });
});
