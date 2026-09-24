import { getExeSingleHostWorkspaceSwitchPath } from './getExeSingleHostWorkspaceSwitchPath';

describe('getExeSingleHostWorkspaceSwitchPath', () => {
  it('uses explicit same-host routes for the two Exe workspaces', () => {
    expect(
      getExeSingleHostWorkspaceSwitchPath({
        hostname: 'crm.askexe.com',
        workspaceName: 'DEMO',
      }),
    ).toBe('/welcome?demo=1');
    expect(
      getExeSingleHostWorkspaceSwitchPath({
        hostname: 'crm.askexe.com',
        workspaceName: 'Exe',
      }),
    ).toBe('/api/auth/gotrue-callback');
  });

  it('preserves native routing elsewhere and for unknown workspaces', () => {
    for (const input of [
      {
        hostname: 'crm.example.com',
        workspaceName: 'DEMO',
      },
      {
        hostname: 'crm.askexe.com',
        workspaceName: 'Other',
      },
    ]) {
      expect(getExeSingleHostWorkspaceSwitchPath(input)).toBeUndefined();
    }
  });
});
