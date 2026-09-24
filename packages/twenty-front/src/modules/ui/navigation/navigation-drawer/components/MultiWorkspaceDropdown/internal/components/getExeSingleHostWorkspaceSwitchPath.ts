// Exe serves both CRM workspaces on crm.askexe.com. Twenty's normal switch
// needs wildcard workspace subdomains, which this deployment does not have.
// These routes rebind the session after checking GoTrue identity and roles.
export const getExeSingleHostWorkspaceSwitchPath = ({
  hostname,
  isMultiWorkspaceEnabled,
  workspaceName,
}: {
  hostname: string;
  isMultiWorkspaceEnabled: boolean;
  workspaceName: string | null | undefined;
}): string | undefined => {
  if (hostname !== 'crm.askexe.com' || isMultiWorkspaceEnabled) {
    return undefined;
  }

  if (workspaceName === 'DEMO') return '/welcome?demo=1';
  if (workspaceName === 'Exe') return '/api/auth/gotrue-callback';

  return undefined;
};
