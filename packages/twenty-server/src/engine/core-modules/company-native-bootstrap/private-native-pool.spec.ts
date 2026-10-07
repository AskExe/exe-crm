import { EventEmitter } from 'node:events';

import { Client, Pool } from 'pg';
import { DataSource } from 'typeorm';

// Actual TypeORM and pg pooling with inert clients: no socket, SQL or native state.
class ControlledClient extends EventEmitter {
  static nextId = 0;
  static queries: { clientId: number; query: string }[] = [];
  readonly id = ControlledClient.nextId++;
  _queryable = true;
  _ending = false;

  connect(callback: () => void) {
    process.nextTick(callback);
  }

  query(query: string) {
    ControlledClient.queries.push({ clientId: this.id, query });
    return Promise.resolve({ rows: [] });
  }

  end(callback?: () => void) {
    this._ending = true;
    process.nextTick(() => {
      this.emit('end');
      callback?.();
    });
  }
}

describe('private native retained transactions and independent guard checkout', () => {
  beforeEach(() => {
    jest.useRealTimers();
    ControlledClient.nextId = 0;
    ControlledClient.queries = [];
  });

  it.each(['writer', 'observer'])(
    'refuses a fresh %s guard checkout while a max1 pool is retained',
    async () => {
      const pool = new Pool({
        max: 1,
        connectionTimeoutMillis: 20,
        Client: ControlledClient as unknown as typeof Client,
      });
      const database = new DataSource({ type: 'postgres', logging: false });
      (database.driver as unknown as { master: Pool }).master = pool;
      (database as unknown as { isInitialized: boolean }).isInitialized = true;
      const runner = database.createQueryRunner();
      try {
        await runner.connect();
        await expect(
          database.query('SELECT controlled_guard'),
        ).rejects.toThrow();
        expect(ControlledClient.queries).toHaveLength(0);
        expect(pool.totalCount).toBe(1);
        expect(pool.idleCount).toBe(0);
      } finally {
        await runner.release();
        await pool.end();
      }
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
    },
  );

  it.each(['writer', 'observer'])(
    'uses a separate %s guard connection at max2 and closes both clients',
    async () => {
      const pool = new Pool({
        max: 2,
        connectionTimeoutMillis: 20,
        Client: ControlledClient as unknown as typeof Client,
      });
      const database = new DataSource({ type: 'postgres', logging: false });
      (database.driver as unknown as { master: Pool }).master = pool;
      (database as unknown as { isInitialized: boolean }).isInitialized = true;
      const runner = database.createQueryRunner();
      try {
        await runner.connect();
        await runner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await database.query('SELECT controlled_guard');
        await runner.query('SELECT controlled_transaction');
        const [begin, guard, transaction] = ControlledClient.queries;
        expect(guard.clientId).not.toBe(begin.clientId);
        expect(transaction.clientId).toBe(begin.clientId);
        expect(pool.totalCount).toBe(2);
        expect(pool.idleCount).toBe(1);
      } finally {
        await runner.release();
        await pool.end();
      }
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
    },
  );
});
