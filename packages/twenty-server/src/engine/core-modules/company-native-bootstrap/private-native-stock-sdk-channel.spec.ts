import { createHash } from 'node:crypto';
import { PrivateNativeStockSdkChannel } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-channel';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';
import { performance } from 'node:perf_hooks';

import { DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  PrivateNativeActionUnavailable,
  type PrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';

jest.mock('src/engine/core-modules/application/application.entity', () => ({
  ApplicationEntity: class {},
}));
jest.mock(
  'src/engine/core-modules/user-workspace/user-workspace.entity',
  () => ({ UserWorkspaceEntity: class {} }),
);
jest.mock('src/engine/core-modules/user/user.entity', () => ({
  UserEntity: class {},
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class {},
}));

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const tuple: PrivateNativeActionTuple = {
  job_id: id('1'),
  lease_token: id('2'),
  attempt: 1,
  worker_id: 'controlled',
  company_id: id('3'),
  deployment_id: id('4'),
  product: 'crm-workspace',
  profile_sha256: '1'.repeat(64),
  config_sha256: '2'.repeat(64),
  initializer_sha256: '3'.repeat(64),
  request_key: id('5'),
  intent_id: id('6'),
  action_id: id('7'),
};
const owner = id('8');
const workspaceId = id('9');
const userId = id('a');
const userWorkspaceId = id('b');
const applicationId = id('c');
const platformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'platform',
)!;
const endpoint = { database: 'native', address: '10.0.0.2', port: 5432 };

// Actual issued fence with inert SQL/catalog responses. These controls prove
// source confinement and revocation ordering, not database privileges or setup.
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  fstatSync: () => ({ isSocket: () => true, uid: 1000 }),
}));
jest.mock('node:net', () => ({
  ...jest.requireActual('node:net'),
  Socket: class extends require('node:events').EventEmitter {
    closed = false;
    pause() {}
    destroy() {
      this.closed = true;
      this.emit('close');
    }
  },
}));
// Actual issued checkpoint and actual channel methods, inert SQL/socket/transfer only.
describe('SDK application binding source controls', () => {
  let revoked: boolean;
  let rows: Record<string, unknown>[];
  let readIndex: number;
  let afterRead: (() => void) | undefined;
  let getRepository: jest.Mock;
  let target: DataSource;
  let workEnd: number;

  async function issued() {
    const { lease_token: _secret, ...projection } = tuple;
    const sqlStart = Date.now();
    const monotonicStart = performance.now();
    const worker = {
      query: jest.fn(async () => {
        if (revoked) throw new PrivateNativeActionUnavailable();
        return [
          {
            authority: {
              ...projection,
              owner_subject: owner,
              sql_time: new Date(
                sqlStart + performance.now() - monotonicStart,
              ).toISOString(),
              lease_expires_at: new Date(sqlStart + 600000).toISOString(),
            },
          },
        ];
      }),
    } as unknown as DataSource;
    const original = {
      query: jest.fn(async (sql: string) =>
        sql.includes('inet_server_addr')
          ? [endpoint]
          : sql.includes('JOIN core.')
            ? [
                {
                  actionId: tuple.action_id,
                  workspaceId,
                  userId,
                  userWorkspaceId,
                  applicationId,
                  ownerSubject: owner,
                  databaseSchema: null,
                },
              ]
            : [{ actionId: tuple.action_id }],
      ),
    } as unknown as DataSource;
    workEnd = performance.now() + 10000;
    return PrivateNativeMutationFence.bindCommittedMarker(
      original,
      new PrivateNativeActionReader(worker, true),
      tuple,
      owner,
      workEnd,
      performance.now() + 120000,
      61000,
      'controlled_writer',
    );
  }

  beforeEach(() => {
    revoked = false;
    readIndex = 0;
    afterRead = undefined;
    rows = [
      {
        id: workspaceId,
        activationStatus: 'PENDING_CREATION',
        databaseSchema: null,
        workspaceCustomApplicationId: applicationId,
        deletedAt: null,
        suspendedAt: null,
      },
      {
        id: userId,
        email: `subject-${owner}@native.invalid`,
        deletedAt: null,
        disabled: false,
        isEmailVerified: false,
        passwordHash: null,
        canImpersonate: false,
        canAccessFullAdminPanel: false,
      },
      { id: userWorkspaceId, workspaceId, userId, deletedAt: null },
      {
        id: applicationId,
        workspaceId,
        universalIdentifier: applicationId,
        deletedAt: null,
      },
    ];
    getRepository = jest.fn(() => ({
      findOneBy: jest.fn(async () => {
        const row = rows[readIndex++];
        afterRead?.();
        return row;
      }),
    }));
    target = {
      query: jest.fn(async () => [endpoint]),
      getRepository,
    } as unknown as DataSource;
    jest
      .spyOn(PrivateNativeDatabaseGuard.prototype, 'assertCurrent')
      .mockResolvedValue();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  async function fixture() {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    let standardId = id('d');
    jest.mocked(target.getRepository).mockReturnValue({
      find: jest.fn(async () => [
        {
          id: standardId,
          ...TWENTY_STANDARD_APPLICATION,
          canBeUninstalled: false,
          packageJsonFileId: id('e'),
          yarnLockFileId: id('f'),
          packageJsonChecksum: 'p',
          yarnLockChecksum: 'y',
        },
        { id: applicationId, workspaceId, universalIdentifier: applicationId },
      ]),
    } as never);
    Object.defineProperty(process, 'platform', {
      ...platformDescriptor,
      value: 'linux',
    });
    jest.spyOn(process, 'getuid').mockReturnValue(1000);
    const channel = await PrivateNativeStockSdkChannel.bind(checkpoint);
    let reply = Buffer.alloc(0);
    const messages: Record<string, unknown>[] = [];
    const transfer = jest
      .spyOn(
        channel as unknown as {
          transfer(b: Buffer, write: boolean): Promise<void>;
        },
        'transfer',
      )
      .mockImplementation(async (b, write) => {
        await checkpoint.assertCurrent();
        if (write) {
          if (b.length === 4) return;
          const value = JSON.parse(b.toString());
          messages.push(value);
          if (!value.version) reply = Buffer.from(b);
          else {
            const archive = Buffer.concat([
              Buffer.from([0x50, 0x4b, 0x03, 0x04]),
              Buffer.from('inert transport archive bytes'),
            ]);
            reply = Buffer.from(
              JSON.stringify({
                ...value,
                schema: undefined,
                archiveBase64: archive.toString('base64'),
                archiveBytes: archive.length,
                archiveSha256: createHash('sha256')
                  .update(archive)
                  .digest('hex'),
              }),
            );
          }
        } else if (b.length === 4) b.writeUInt32BE(reply.length);
        else reply.copy(b);
        await checkpoint.assertCurrent();
      });
    return {
      checkpoint,
      channel,
      messages,
      transfer,
      change: () => {
        standardId = id('e');
      },
    };
  }
  function request(
    applicationId: string,
    applicationUniversalIdentifier: string,
  ) {
    return {
      version: 1 as const,
      actionId: tuple.action_id,
      workspaceId,
      applicationId,
      applicationUniversalIdentifier,
      schema: 'type Query { owned: String }',
    };
  }
  it('binds once, executes standard then custom and closes both owned model sockets', async () => {
    const f = await fixture();
    try {
      const snapshot = await f.checkpoint.readOriginalStockApplications();
      await f.channel.bindApplications(snapshot);
      await f.channel.generate(
        request(
          snapshot.standardApplicationId,
          TWENTY_STANDARD_APPLICATION.universalIdentifier,
        ),
      );
      await f.channel.bindApplications(
        await f.checkpoint.readOriginalStockApplications(),
      );
      await f.channel.generate(request(applicationId, applicationId));
      expect(f.messages.map((m) => m.applicationId ?? 'snapshot')).toEqual([
        'snapshot',
        id('d'),
        applicationId,
      ]);
    } finally {
      await f.channel.close();
    }
  });
  it('refuses a freshly changed stock snapshot without a second handshake', async () => {
    const f = await fixture();
    try {
      await f.channel.bindApplications(
        await f.checkpoint.readOriginalStockApplications(),
      );
      f.change();
      await expect(
        f.channel.bindApplications(
          await f.checkpoint.readOriginalStockApplications(),
        ),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(f.messages).toHaveLength(1);
    } finally {
      await f.channel.close();
    }
  });
  it('refuses manufactured snapshots before transport', async () => {
    const f = await fixture();
    try {
      const snapshot = await f.checkpoint.readOriginalStockApplications();
      await expect(
        f.channel.bindApplications({ ...snapshot }),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(f.messages).toHaveLength(0);
    } finally {
      await f.channel.close();
    }
  });
  it('refuses custom first and standard twice without sending invalid requests', async () => {
    const f = await fixture();
    try {
      const snapshot = await f.checkpoint.readOriginalStockApplications();
      await f.channel.bindApplications(snapshot);
      await expect(
        f.channel.generate(request(applicationId, applicationId)),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      await f.channel.generate(
        request(
          snapshot.standardApplicationId,
          TWENTY_STANDARD_APPLICATION.universalIdentifier,
        ),
      );
      await expect(
        f.channel.generate(
          request(
            snapshot.standardApplicationId,
            TWENTY_STANDARD_APPLICATION.universalIdentifier,
          ),
        ),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(f.messages).toHaveLength(2);
    } finally {
      await f.channel.close();
    }
  });
  it('refuses revoked original action before any snapshot transport', async () => {
    const f = await fixture();
    try {
      const snapshot = await f.checkpoint.readOriginalStockApplications();
      revoked = true;
      await expect(f.channel.bindApplications(snapshot)).rejects.toBeInstanceOf(
        PrivateNativeActionUnavailable,
      );
      expect(f.messages).toHaveLength(0);
    } finally {
      await f.channel.close();
    }
  });
});
