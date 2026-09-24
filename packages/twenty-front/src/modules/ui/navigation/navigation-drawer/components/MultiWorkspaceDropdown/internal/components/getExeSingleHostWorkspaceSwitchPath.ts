// Exe serves both CRM workspaces on crm.askexe.com. The normal switch
// needs wildcard workspace subdomains, which this deployment does not have.
// Use the host as the authority even if the client routing flag is stale.
// These routes rebind the session after checking GoTrue identity and roles.
export const getExeSingleHostWorkspaceSwitchPath = ({
  hostname,
  workspaceName,
}: {
  hostname: string;
  workspaceName: string | null | undefined;
}): string | undefined => {
  if (hostname !== 'crm.askexe.com') {
    return undefined;
  }

  if (workspaceName === 'DEMO') return '/welcome?demo=1';
  if (workspaceName === 'Exe') return '/api/auth/gotrue-callback';

  return undefined;
};
