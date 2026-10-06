import {
  assertPrivatePeopleCatalogRoleProjection,
  privatePeopleCatalogRoleName,
} from './private-people-role-catalog-projection';

const company = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const foreignWorkspace = '33333333-3333-4333-8333-333333333333';
const database = 'crm_company_a';
const projection = () => ({
  roleOid: 17000,
  roleName: privatePeopleCatalogRoleName(company, workspace, 'metadata'),
  canLogin: true,
  inherits: false,
  superuser: false,
  createsDatabase: false,
  createsRole: false,
  replicates: false,
  bypassesRls: false,
  databaseOid: 18000,
  databaseName: database,
  ownsDatabase: false,
  canCreateOrTemp: false,
  hasMemberships: false,
});

// Controlled catalog rows only; no SQL, RLS or native grant qualification.
describe('private role catalog projection', () => {
  it('accepts a closed current-pair metadata role projection without admitting IO', () => {
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        projection(),
        company,
        workspace,
        'metadata',
        database,
      ),
    ).not.toThrow();
  });
  it('refuses foreign workspace and writer-role substitution', () => {
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        projection(),
        company,
        foreignWorkspace,
        'metadata',
        database,
      ),
    ).toThrow();
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        projection(),
        company,
        workspace,
        'writer',
        database,
      ),
    ).toThrow();
  });
  it('refuses another protected database association', () => {
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        projection(),
        company,
        workspace,
        'metadata',
        'crm_company_b',
      ),
    ).toThrow();
  });
  it('refuses every privileged flag and missing login', () => {
    for (const key of [
      'inherits',
      'superuser',
      'createsDatabase',
      'createsRole',
      'replicates',
      'bypassesRls',
      'ownsDatabase',
      'canCreateOrTemp',
      'hasMemberships',
    ]) {
      expect(() =>
        assertPrivatePeopleCatalogRoleProjection(
          { ...projection(), [key]: true },
          company,
          workspace,
          'metadata',
          database,
        ),
      ).toThrow();
    }
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        { ...projection(), canLogin: false },
        company,
        workspace,
        'metadata',
        database,
      ),
    ).toThrow();
  });
  it('accepts the upper PostgreSQL OID boundary for both OIDs', () => {
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        { ...projection(), roleOid: 4294967295, databaseOid: 4294967295 },
        company,
        workspace,
        'metadata',
        database,
      ),
    ).not.toThrow();
  });
  it('refuses invalid OIDs and invented admission flags', () => {
    for (const invalid of [0, -1, 4294967296, 1.5, NaN, Infinity]) {
      for (const key of ['roleOid', 'databaseOid']) {
        expect(() =>
          assertPrivatePeopleCatalogRoleProjection(
            { ...projection(), [key]: invalid },
            company,
            workspace,
            'metadata',
            database,
          ),
        ).toThrow();
      }
    }
    for (const change of [{ admitted: true }]) {
      expect(() =>
        assertPrivatePeopleCatalogRoleProjection(
          { ...projection(), ...change },
          company,
          workspace,
          'metadata',
          database,
        ),
      ).toThrow();
    }
  });
  it('refuses a Proxy without traps and accessors without reads', () => {
    const trap = jest.fn();
    const proxy = new Proxy(projection(), {
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        proxy,
        company,
        workspace,
        'metadata',
        database,
      ),
    ).toThrow();
    const getter = jest.fn();
    const accessor = Object.defineProperty(projection(), 'roleName', {
      get: getter,
    });
    expect(() =>
      assertPrivatePeopleCatalogRoleProjection(
        accessor,
        company,
        workspace,
        'metadata',
        database,
      ),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });
});
