import { createHash } from 'node:crypto';

import {
  capturePrivatePeople,
  type PrivatePeopleSource,
} from './private-people-contract';

const uuid = '11111111-1111-4111-8111-111111111111';
const fixture = (text = '[{"name":"Contact A","email":"a@example.test"}]') => {
  const bytes = Buffer.from(text);
  const source: PrivatePeopleSource = {
    version: 2,
    purpose: 'business-action',
    subject_id: uuid,
    company_id: uuid,
    product: 'crm',
    resource_kind: 'crm-workspace',
    client_id: 'client-a',
    binding_id: uuid,
    native_id: uuid,
    generation_id: uuid,
    authz_epoch: '1',
    audience: 'crm-a',
    current_role: 'member',
    action: 'crm:people:create',
    policy_revision: '1',
    commerce: null,
    request_id: uuid,
    payload_sha256: createHash('sha256').update(bytes).digest('hex'),
    expires_at: '2099-01-01T00:00:00.000Z',
  };
  return { source, bytes };
};

describe('private people closed canonical projection', () => {
  it('snapshots the exact Core payload without caller-native IDs', () => {
    const f = fixture();
    const captured = capturePrivatePeople(f.source, f.bytes);
    expect(captured.rows).toEqual([
      { name: 'Contact A', email: 'a@example.test' },
    ]);
    expect(Object.isFrozen(captured.rows[0])).toBe(true);
  });
  it.each([
    '[{"name":"A","name":"B","email":"a@example.test"}]',
    '[ {"name":"A","email":"a@example.test"}]',
    '[{"name":"A","email":"a@example.test","id":"caller"}]',
  ])('refuses duplicate/noncanonical/extra payload: %s', (text) => {
    const f = fixture(text);
    expect(() => capturePrivatePeople(f.source, f.bytes)).toThrow();
  });
  it('refuses a getter before it can execute or initiate IO', () => {
    const f = fixture();
    const getter = jest.fn();
    Object.defineProperty(f.source, 'native_id', {
      enumerable: true,
      get: getter,
    });
    expect(() => capturePrivatePeople(f.source, f.bytes)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('refuses digest substitution and extra source authority fields', () => {
    const f = fixture();
    expect(() =>
      capturePrivatePeople(
        { ...f.source, payload_sha256: '0'.repeat(64) },
        f.bytes,
      ),
    ).toThrow();
    expect(() =>
      capturePrivatePeople(
        { ...f.source, role: 'admin' } as PrivatePeopleSource,
        f.bytes,
      ),
    ).toThrow();
  });
  it('create refuses multiple rows while import retains the same exact rows', () => {
    const f = fixture(
      '[{"name":"A","email":"a@example.test"},{"name":"B","email":"b@example.test"}]',
    );
    expect(() => capturePrivatePeople(f.source, f.bytes)).toThrow();
    expect(
      capturePrivatePeople(
        { ...f.source, action: 'crm:people:import' },
        f.bytes,
      ).rows,
    ).toHaveLength(2);
  });
});
