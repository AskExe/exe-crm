import { Avatar } from 'twenty-ui/display';
import { MenuItemSelectAvatar, UndecoratedLink } from 'twenty-ui/navigation';
import { DEFAULT_WORKSPACE_LOGO } from '@/ui/navigation/navigation-drawer/constants/DefaultWorkspaceLogo';
import { type AvailableWorkspace } from '~/generated-metadata/graphql';
import { useRedirectToWorkspaceDomain } from '@/domain-manager/hooks/useRedirectToWorkspaceDomain';
import { getWorkspaceUrl } from '~/utils/getWorkspaceUrl';
import { getAvailableWorkspacePathAndSearchParams } from '@/auth/utils/availableWorkspacesUtils';
import { t } from '@lingui/core/macro';
import React from 'react';
import { useBuildWorkspaceUrl } from '@/domain-manager/hooks/useBuildWorkspaceUrl';
import { isMultiWorkspaceEnabledState } from '@/client-config/states/isMultiWorkspaceEnabledState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { getExeSingleHostWorkspaceSwitchPath } from './getExeSingleHostWorkspaceSwitchPath';

export const AvailableWorkspaceItem = ({
  availableWorkspace,
  isSelected,
}: {
  availableWorkspace: AvailableWorkspace;
  isSelected: boolean;
}) => {
  const { buildWorkspaceUrl } = useBuildWorkspaceUrl();
  const isMultiWorkspaceEnabled = useAtomStateValue(
    isMultiWorkspaceEnabledState,
  );

  const { redirectToWorkspaceDomain } = useRedirectToWorkspaceDomain();

  const { pathname, searchParams } =
    getAvailableWorkspacePathAndSearchParams(availableWorkspace);
  const exeSingleHostPath = getExeSingleHostWorkspaceSwitchPath({
    hostname: window.location.hostname,
    isMultiWorkspaceEnabled,
    workspaceName: availableWorkspace.displayName,
  });

  const handleChange = async () => {
    await redirectToWorkspaceDomain(
      getWorkspaceUrl(availableWorkspace.workspaceUrls),
      pathname,
      searchParams,
    );
  };

  return (
    <UndecoratedLink
      key={availableWorkspace.id}
      to={
        exeSingleHostPath ??
        buildWorkspaceUrl(
          getWorkspaceUrl(availableWorkspace.workspaceUrls),
          pathname,
          searchParams,
        )
      }
      onClick={(event) => {
        event.preventDefault();
        if (exeSingleHostPath) {
          window.location.assign(exeSingleHostPath);
          return;
        }
        handleChange();
      }}
    >
      <MenuItemSelectAvatar
        text={availableWorkspace.displayName ?? t`(No name)`}
        avatar={
          <Avatar
            placeholder={availableWorkspace.displayName || ''}
            avatarUrl={availableWorkspace.logo ?? DEFAULT_WORKSPACE_LOGO}
          />
        }
        selected={isSelected}
      />
    </UndecoratedLink>
  );
};
