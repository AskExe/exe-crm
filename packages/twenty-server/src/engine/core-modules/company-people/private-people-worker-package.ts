import { createHash } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs';

import { DataSource } from 'typeorm';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { type CompanyAuthConfiguration } from 'src/engine/core-modules/company-auth/company-auth.config';
import { PrivatePeopleAdapter } from './private-people-adapter';
import { closedPeopleMessage } from './private-people-protocol';

class PrivatePeoplePackageSettlement extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanup: unknown,
  ) {
    super('Private people package settlement failed');
  }
}

const ROOT = '/run/secrets/crm-people-worker';
const ASSEMBLY = '/app/packages/twenty-server/private-people-runtime.cjs';
const fingerprint = (s: Stats) =>
  [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs].join(
    ':',
  );
const protectedBytes = (path: string, uid: number, maximum: number) => {
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== uid ||
    before.nlink !== 1 ||
    before.mode & 0o222 ||
    before.size < 1 ||
    before.size > maximum ||
    realpathSync(path) !== path
  )
    throw new Error('Private people package trust unavailable');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let first: unknown;
  try {
    if (fingerprint(fstatSync(fd)) !== fingerprint(before))
      throw new Error('Private people package changed');
    const bytes = readFileSync(fd);
    if (
      bytes.length !== before.size ||
      fingerprint(fstatSync(fd)) !== fingerprint(before) ||
      fingerprint(lstatSync(path)) !== fingerprint(before)
    )
      throw new Error('Private people package changed');
    return bytes;
  } catch (error) {
    first = error;
    throw error;
  } finally {
    try {
      closeSync(fd);
    } catch (cleanup) {
      if (first !== undefined)
        throw new PrivatePeoplePackageSettlement(first, cleanup);
      throw cleanup;
    }
  }
};

export type PrivatePeopleWorkerResources = {
  configuration: CompanyAuthConfiguration;
  core: DataSource;
  writer: DataSource;
  orm: GlobalWorkspaceOrmManager;
  cache: WorkspaceCacheService;
  emitter: WorkspaceEventEmitter;
};

// Fixed operator package module, never a caller/environment module selector.
// Its actual Source/provider/import closure must be separately reviewed/pinned.
export const loadPrivatePeopleWorkerPackage =
  (): PrivatePeopleWorkerResources => {
    if (process.platform !== 'linux' || process.getuid?.() !== 1000)
      throw new Error('Private people package host unavailable');
    for (const path of [
      ROOT,
      '/app',
      '/app/packages',
      '/app/packages/twenty-server',
    ]) {
      const s = lstatSync(path);
      if (
        !s.isDirectory() ||
        s.isSymbolicLink() ||
        realpathSync(path) !== path ||
        s.uid !== (path === ROOT ? 1000 : 0) ||
        s.mode & 0o022 ||
        (path === ROOT && (s.mode & 0o7777) !== 0o700)
      )
        throw new Error('Private people package parent unavailable');
    }
    const trustBytes = protectedBytes(
      ROOT + '/assembly-trust.json',
      1000,
      4096,
    );
    const trust: unknown = JSON.parse(trustBytes.toString('utf8'));
    if (
      !closedPeopleMessage(trust, ['version', 'enabled', 'assembly_sha256']) ||
      trust.version !== 1 ||
      trust.enabled !== true ||
      typeof trust.assembly_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(trust.assembly_sha256) ||
      JSON.stringify(trust) !== trustBytes.toString('utf8')
    )
      throw new Error('Private people package admission unavailable');
    const bytes = protectedBytes(ASSEMBLY, 0, 1048576);
    if (
      createHash('sha256').update(bytes).digest('hex') !== trust.assembly_sha256
    )
      throw new Error('Private people assembly unavailable');
    // Node loads only this immutable fixed root-owned file after the original
    // PREPARE projection was captured. No AppModule/HTTP/tenant entry is imported.
    const value: unknown = require(ASSEMBLY);
    if (
      !closedPeopleMessage(value, [
        'configuration',
        'core',
        'writer',
        'orm',
        'cache',
        'emitter',
      ]) ||
      !(value.core instanceof DataSource) ||
      !(value.writer instanceof DataSource) ||
      value.core === value.writer ||
      !(value.orm instanceof GlobalWorkspaceOrmManager) ||
      !(value.cache instanceof WorkspaceCacheService) ||
      !(value.emitter instanceof WorkspaceEventEmitter)
    )
      throw new Error('Private people real service graph unavailable');
    protectedBytes(ASSEMBLY, 0, 1048576); // Recheck immutable name/fd; package graph remains a qualification gate.
    return value as PrivatePeopleWorkerResources;
  };

export const createWorkerAdapter = (resources: PrivatePeopleWorkerResources) =>
  new PrivatePeopleAdapter({
    enabled: true,
    configuration: resources.configuration,
    core: resources.core,
    orm: resources.orm,
    cache: resources.cache,
    emitter: resources.emitter,
  });
