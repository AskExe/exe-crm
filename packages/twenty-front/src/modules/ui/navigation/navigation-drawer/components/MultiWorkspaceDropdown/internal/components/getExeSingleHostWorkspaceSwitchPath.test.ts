import { getExeSingleHostWorkspaceSwitchPath } from './getExeSingleHostWorkspaceSwitchPath';

describe('getExeSingleHostWorkspaceSwitchPath', () => {
  it('uses explicit same-host routes for the two Exe workspaces', () => {
    expect(
      getExeSingleHostWorkspaceSwitchPath({
        hostname: 'crm.askexe.com',
        isMultiWorkspaceEnabled: false,
        workspaceName: 'DEMO',
      }),
    ).toBe('/welcome?demo=1');
    expect(
      getExeSingleHostWorkspaceSwitchPath({
        hostname: 'crm.askexe.com',
        isMultiWorkspaceEnabled: false,
        workspaceName: 'Exe',
      }),
    ).toBe('/api/auth/gotrue-callback');
  });

  it('preserves native routing elsewhere and for unknown workspaces', () => {
    for (const input of [
      {
        hostname: 'crm.askexe.com',
        isMultiWorkspaceEnabled: true,
        workspaceName: 'DEMO',
      },
      {
        hostname: 'crm.example.com',
        isMultiWorkspaceEnabled: false,
        workspaceName: 'DEMO',
      },
      {
        hostname: 'crm.askexe.com',
        isMultiWorkspaceEnabled: false,
        workspaceName: 'Other',
      },
    ]) {
      expect(getExeSingleHostWorkspaceSwitchPath(input)).toBeUndefined();
    }
  });
});
