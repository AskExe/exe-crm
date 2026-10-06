import { type Cache } from '@nestjs/cache-manager';

import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';

import {
  assertPrivatePeopleRoleBinding,
  capturePrivatePeopleCurrentPair,
  derivePrivatePeopleRoleBinding,
  readPrivatePeopleSharedRoleProfile,
  privatePeopleBoundRedisKey,
  privatePeopleExpectedConnectionRole,
} from './private-people-role-binding';

const companyA = '11111111-1111-4111-8111-111111111111';
const companyB = '22222222-2222-4222-8222-222222222222';
const workspaceA = '33333333-3333-4333-8333-333333333333';
const workspaceB = '44444444-4444-4444-8444-444444444444';

describe('protected shared company role binding', () => {
  it('derives deterministic bounded role names and a complete company/workspace prefix', () => {
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    expect(derivePrivatePeopleRoleBinding(companyA, workspaceA)).toEqual(
      binding,
    );
    for (const role of [
      binding.metadataRole,
      binding.writerRole,
      binding.cacheRole,
    ]) {
      expect(Buffer.byteLength(role)).toBe(62);
      expect(role).toMatch(/^crm_[mwc]_[a-f0-9]{56}$/);
    }
    expect(binding.cachePrefix).toBe(
      `crm:company:${companyA}:workspace:${workspaceA}:`,
    );
    expect(Object.isFrozen(binding)).toBe(true);
    expect(() =>
      assertPrivatePeopleRoleBinding(binding, companyA, workspaceA),
    ).not.toThrow();
  });

  it('refuses the B credential-role association in the A company or workspace', () => {
    const binding = derivePrivatePeopleRoleBinding(companyB, workspaceB);
    expect(() =>
      assertPrivatePeopleRoleBinding(binding, companyA, workspaceA),
    ).toThrow();
    expect(() =>
      assertPrivatePeopleRoleBinding(binding, companyB, workspaceA),
    ).toThrow();
    expect(() =>
      assertPrivatePeopleRoleBinding(binding, companyA, workspaceB),
    ).toThrow();
  });

  it('refuses a substituted role or prefix even when UUID fields match', () => {
    const a = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    const b = derivePrivatePeopleRoleBinding(companyB, workspaceB);
    expect(() =>
      assertPrivatePeopleRoleBinding(
        { ...a, writerRole: b.writerRole },
        companyA,
        workspaceA,
      ),
    ).toThrow();
    expect(() =>
      assertPrivatePeopleRoleBinding(
        { ...a, cachePrefix: b.cachePrefix },
        companyA,
        workspaceA,
      ),
    ).toThrow();
  });

  it('refuses noncanonical, malformed and nil UUID inputs rather than choosing a fallback', () => {
    for (const value of [
      '00000000-0000-0000-0000-000000000000',
      companyA.toUpperCase().replace('1', 'A'),
      'role-a',
      '../company',
    ]) {
      expect(() => derivePrivatePeopleRoleBinding(value, workspaceA)).toThrow();
      expect(() => derivePrivatePeopleRoleBinding(companyA, value)).toThrow();
    }
  });

  it('admits only the closed v2 profile matching the trusted current pair', () => {
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    expect(
      readPrivatePeopleSharedRoleProfile(
        { version: 2, ...binding },
        companyA,
        workspaceA,
      ),
    ).toEqual(binding);
    expect(() =>
      readPrivatePeopleSharedRoleProfile(
        { version: 1, ...binding },
        companyA,
        workspaceA,
      ),
    ).toThrow();
    expect(() =>
      readPrivatePeopleSharedRoleProfile(
        { version: 2, ...binding, selectedRole: 'admin' },
        companyA,
        workspaceA,
      ),
    ).toThrow();
    expect(() =>
      readPrivatePeopleSharedRoleProfile(
        { version: 2, ...binding },
        companyB,
        workspaceB,
      ),
    ).toThrow();
  });

  it('rejects proxy and accessor profiles without invoking traps or getters', () => {
    let invoked = 0;
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    const proxy = new Proxy(
      { version: 2, ...binding },
      {
        ownKeys: () => {
          invoked += 1;
          return [];
        },
        getPrototypeOf: () => {
          invoked += 1;
          return Object.prototype;
        },
      },
    );
    expect(() =>
      readPrivatePeopleSharedRoleProfile(proxy, companyA, workspaceA),
    ).toThrow();
    const accessor = { version: 2, ...binding };
    Object.defineProperty(accessor, 'writerRole', {
      get: () => {
        invoked += 1;
        return binding.writerRole;
      },
    });
    expect(() =>
      readPrivatePeopleSharedRoleProfile(accessor, companyA, workspaceA),
    ).toThrow();
    expect(invoked).toBe(0);
  });

  it('snapshots the trusted current pair before protected configuration and refuses proxy/accessor selectors', () => {
    const mutable = { companyId: companyA, workspaceId: workspaceA };
    const retained = capturePrivatePeopleCurrentPair(mutable);
    Object.assign(mutable, { companyId: companyB, workspaceId: workspaceB });
    expect(retained).toEqual({ companyId: companyA, workspaceId: workspaceA });
    expect(Object.isFrozen(retained)).toBe(true);
    let traps = 0;
    const proxy = new Proxy(mutable, {
      getPrototypeOf: () => {
        traps += 1;
        return Object.prototype;
      },
    });
    expect(() => capturePrivatePeopleCurrentPair(proxy)).toThrow();
    const accessor = { workspaceId: workspaceA };
    Object.defineProperty(accessor, 'companyId', {
      get: () => {
        traps += 1;
        return companyA;
      },
    });
    expect(() => capturePrivatePeopleCurrentPair(accessor)).toThrow();
    expect(traps).toBe(0);
  });

  it('derives only the fixed metadata, writer and cache roles from the retained binding', () => {
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    expect(privatePeopleExpectedConnectionRole(binding, 'metadata')).toBe(
      binding.metadataRole,
    );
    expect(privatePeopleExpectedConnectionRole(binding, 'writer')).toBe(
      binding.writerRole,
    );
    expect(privatePeopleExpectedConnectionRole(binding, 'cache')).toBe(
      binding.cacheRole,
    );
    expect(() =>
      privatePeopleExpectedConnectionRole(
        { ...binding, writerRole: 'crm_people_writer' },
        'writer',
      ),
    ).toThrow();
  });

  it('binds complete native data/hash keys and refuses foreign or wildcard Redis keys', () => {
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    for (const part of ['data', 'hash']) {
      const key = `flat-maps:object-metadata:${workspaceA}:${part}`;
      expect(privatePeopleBoundRedisKey(binding, 'engine:workspace', key)).toBe(
        `${binding.cachePrefix}engine:workspace:${key}`,
      );
    }
    for (const key of [
      `flat-maps:object-metadata:${workspaceB}:data`,
      '*',
      `${workspaceA}:*`,
      `unknown:${workspaceA}:data`,
    ]) {
      expect(() =>
        privatePeopleBoundRedisKey(binding, 'engine:workspace', key),
      ).toThrow();
    }
    expect(() =>
      privatePeopleBoundRedisKey(
        binding,
        'User',
        `flat-maps:object-metadata:${workspaceA}:data`,
      ),
    ).toThrow();
  });
});

// A controlled dependency implements only the IO touched by these cases. This
// type projection never replaces the real factory's required Redis supplier.
const controlledRedisCache = () => {
  const client = {
    mGet: jest.fn(async () => ['null']),
    del: jest.fn(async () => 1),
  };
  const unusedOperation = async (): Promise<never> => {
    throw new Error('Unused controlled cache operation');
  };
  const unusedObserver = (): never => {
    throw new Error('Unused controlled cache observer');
  };
  const store: Cache['store'] & { name: string; client: typeof client } = {
    name: 'redis',
    client,
    get: unusedOperation,
    set: unusedOperation,
    del: unusedOperation,
    reset: unusedOperation,
    mset: unusedOperation,
    mget: unusedOperation,
    mdel: unusedOperation,
    keys: unusedOperation,
    ttl: unusedOperation,
  };
  const cache = {
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined),
    store,
    on: unusedObserver,
    removeListener: unusedObserver,
    wrap: unusedOperation,
  } satisfies Cache;
  return { cache, client, projected: cache };
};

describe('default-absent private Redis key boundary', () => {
  const key = `flat-maps:object-metadata:${workspaceA}:data`;

  it('binds get and direct mget/mdel to the same company/workspace prefix', async () => {
    const fixture = controlledRedisCache();
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
      binding,
    );
    const expected = `${binding.cachePrefix}engine:workspace:${key}`;
    await service.get(key);
    await service.mget([key]);
    await service.mdel([key]);
    expect(fixture.cache.get).toHaveBeenCalledWith(expected);
    expect(fixture.client.mGet).toHaveBeenCalledWith([expected]);
    expect(fixture.client.del).toHaveBeenCalledWith([expected]);
  });

  it('refuses B keys before get or either direct Redis call', async () => {
    const fixture = controlledRedisCache();
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
      derivePrivatePeopleRoleBinding(companyA, workspaceA),
    );
    const foreign = `flat-maps:object-metadata:${workspaceB}:data`;
    await expect(service.get(foreign)).rejects.toThrow();
    await expect(service.mget([foreign])).rejects.toThrow();
    await expect(service.mdel([foreign])).rejects.toThrow();
    expect(fixture.cache.get).not.toHaveBeenCalled();
    expect(fixture.client.mGet).not.toHaveBeenCalled();
    expect(fixture.client.del).not.toHaveBeenCalled();
  });

  it('retains the A snapshot when the supplied binding object is later replaced with B fields', async () => {
    const fixture = controlledRedisCache();
    const supplied = {
      ...derivePrivatePeopleRoleBinding(companyA, workspaceA),
    };
    const original = supplied.cachePrefix;
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
      supplied,
    );
    Object.assign(
      supplied,
      derivePrivatePeopleRoleBinding(companyB, workspaceB),
    );
    await service.get(key);
    expect(fixture.cache.get).toHaveBeenCalledWith(
      `${original}engine:workspace:${key}`,
    );
  });

  it('refuses private reset/scans, non-Redis fallback and a different namespace', async () => {
    const fixture = controlledRedisCache();
    const binding = derivePrivatePeopleRoleBinding(companyA, workspaceA);
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
      binding,
    );
    await expect(service.flush()).rejects.toThrow();
    await expect(service.flushByPattern('*')).rejects.toThrow();
    await expect(service.scanAndCountSetMembers('*')).rejects.toThrow();
    expect(fixture.cache.reset).not.toHaveBeenCalled();
    expect(
      () =>
        new CacheStorageService(
          fixture.projected,
          CacheStorageNamespace.EngineCoreEntity,
          binding,
        ),
    ).toThrow();
    fixture.cache.store.name = 'memory';
    expect(
      () =>
        new CacheStorageService(
          fixture.projected,
          CacheStorageNamespace.EngineWorkspace,
          binding,
        ),
    ).toThrow();
  });

  it('refuses a replacement non-Redis store before IO and remains refused after its marker is restored', async () => {
    const fixture = controlledRedisCache();
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
      derivePrivatePeopleRoleBinding(companyA, workspaceA),
    );
    const originalStore = fixture.cache.store;
    fixture.cache.store = { ...originalStore, name: 'memory' };
    await expect(service.get(key)).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    await expect(service.set(key, 'value')).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    await expect(service.mget([key])).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    await expect(service.mdel([key])).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    fixture.cache.store = originalStore;
    await expect(service.get(key)).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    expect(fixture.cache.get).not.toHaveBeenCalled();
    expect(fixture.cache.set).not.toHaveBeenCalled();
    expect(fixture.client.mGet).not.toHaveBeenCalled();
    expect(fixture.client.del).not.toHaveBeenCalled();
    const replacement = controlledRedisCache();
    const retained = new CacheStorageService(
      replacement.projected,
      CacheStorageNamespace.EngineWorkspace,
      derivePrivatePeopleRoleBinding(companyA, workspaceA),
    );
    replacement.cache.store = { ...replacement.cache.store };
    await expect(retained.get(key)).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    expect(replacement.cache.get).not.toHaveBeenCalled();
    const marker = controlledRedisCache();
    const markerService = new CacheStorageService(
      marker.projected,
      CacheStorageNamespace.EngineWorkspace,
      derivePrivatePeopleRoleBinding(companyA, workspaceA),
    );
    const sameStore = marker.cache.store;
    sameStore.name = 'memory';
    await expect(markerService.get(key)).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    sameStore.name = 'redis';
    await expect(markerService.get(key)).rejects.toThrow(
      'Private people Redis cache unavailable',
    );
    expect(marker.cache.store).toBe(sameStore);
    expect(marker.cache.get).not.toHaveBeenCalled();
  });

  it('preserves the native key and reset behavior when private mode is absent', async () => {
    const fixture = controlledRedisCache();
    const service = new CacheStorageService(
      fixture.projected,
      CacheStorageNamespace.EngineWorkspace,
    );
    await service.get(key);
    await service.mget([key]);
    await service.mdel([key]);
    const expected = `integration-tests:engine:workspace:${key}`;
    expect(fixture.cache.get).toHaveBeenCalledWith(expected);
    expect(fixture.client.mGet).toHaveBeenCalledWith([expected]);
    expect(fixture.client.del).toHaveBeenCalledWith([expected]);
    await service.flush();
    expect(fixture.cache.reset).toHaveBeenCalledTimes(1);
  });
});
