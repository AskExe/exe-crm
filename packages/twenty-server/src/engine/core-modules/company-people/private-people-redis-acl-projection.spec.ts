import { derivePrivatePeopleRoleBinding } from './private-people-role-binding';
import { assertPrivatePeopleRedisAclProjection } from './private-people-redis-acl-projection';

const company = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const foreignWorkspace = '33333333-3333-4333-8333-333333333333';
const projection = () => {
  const binding = derivePrivatePeopleRoleBinding(company, workspace);
  return {
    username: binding.cacheRole,
    flags: 'on',
    commands: '-@all +auth +quit +get +set +del +mget',
    keys: `~${binding.cachePrefix}*`,
    channels: '',
    selectors: 0,
    passwordCount: 1,
  };
};

// Handcrafted controlled projections, never actual Redis ACL qualification.
describe('private Redis ACL projection', () => {
  it('accepts only the closed current-pair candidate projection', () => {
    expect(() =>
      assertPrivatePeopleRedisAclProjection(projection(), company, workspace),
    ).not.toThrow();
  });
  it('refuses another workspace role and prefix', () => {
    expect(() =>
      assertPrivatePeopleRedisAclProjection(
        projection(),
        company,
        foreignWorkspace,
      ),
    ).toThrow();
  });
  it('refuses all-command and CLIENT grants', () => {
    for (const commands of [
      '+@all',
      '-@all +auth +quit +get +set +del +mget +client',
    ]) {
      expect(() =>
        assertPrivatePeopleRedisAclProjection(
          { ...projection(), commands },
          company,
          workspace,
        ),
      ).toThrow();
    }
  });
  it('refuses global and foreign key patterns', () => {
    for (const keys of ['~*', '~crm:company:*', '~another:*']) {
      expect(() =>
        assertPrivatePeopleRedisAclProjection(
          { ...projection(), keys },
          company,
          workspace,
        ),
      ).toThrow();
    }
  });
  it('refuses nopass, selector and channel authority', () => {
    for (const change of [
      { flags: 'on nopass' },
      { selectors: 1 },
      { channels: '&*' },
      { passwordCount: 0 },
    ]) {
      expect(() =>
        assertPrivatePeopleRedisAclProjection(
          { ...projection(), ...change },
          company,
          workspace,
        ),
      ).toThrow();
    }
  });
  it('refuses missing or duplicate required commands', () => {
    for (const commands of [
      '-@all +auth +quit +get +set +del',
      '-@all +auth +quit +get +set +del +del',
    ]) {
      expect(() =>
        assertPrivatePeopleRedisAclProjection(
          { ...projection(), commands },
          company,
          workspace,
        ),
      ).toThrow();
    }
  });
  it('refuses accessors without invoking them', () => {
    const getter = jest.fn();
    const value = Object.defineProperty(projection(), 'commands', {
      get: getter,
    });
    expect(() =>
      assertPrivatePeopleRedisAclProjection(value, company, workspace),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('refuses Proxy before any traps or descriptor reads', () => {
    const trap = jest.fn();
    const value = new Proxy(projection(), {
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() =>
      assertPrivatePeopleRedisAclProjection(value, company, workspace),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
  });
  it('does not trust extra captured admission flags', () => {
    expect(() =>
      assertPrivatePeopleRedisAclProjection(
        { ...projection(), admitted: true },
        company,
        workspace,
      ),
    ).toThrow();
  });
});
