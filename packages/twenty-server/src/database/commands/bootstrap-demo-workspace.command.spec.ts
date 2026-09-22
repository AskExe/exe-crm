import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { BootstrapDemoWorkspaceCommand } from 'src/database/commands/bootstrap-demo-workspace.command';

const owner = (id: string, email: string) => ({
  id,
  email,
  isEmailVerified: true,
  disabled: false,
  canAccessFullAdminPanel: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('BootstrapDemoWorkspaceCommand', () => {
  const owners = [
    owner('owner-1', 'one@example.com'),
    owner('owner-2', 'two@example.com'),
  ];
  const ownerOptions = ['owner-1:one@example.com', 'owner-2:two@example.com'];
  const workspace = {
    id: 'demo-workspace',
    displayName: 'DEMO',
    activationStatus: WorkspaceActivationStatus.ACTIVE,
  };

  const setup = ({
    existingWorkspace = null,
    marker = { id: 'marker' },
  }: {
    existingWorkspace?: typeof workspace | null;
    marker?: { id: string } | null;
  } = {}) => {
    const workspaceRepository = {
      findOne: jest.fn().mockResolvedValue(existingWorkspace),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const userRepository = {
      findOneByOrFail: jest.fn(({ id }) =>
        Promise.resolve(owners.find((user) => user.id === id)),
      ),
    };
    const keyValuePairRepository = {
      findOneBy: jest.fn().mockResolvedValue(marker),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const roleRepository = {
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'admin-role' }),
    };
    const signInUpService = {
      signUpOnNewWorkspace: jest
        .fn()
        .mockResolvedValue({ workspace: { id: 'pending' } }),
    };
    const workspaceService = {
      activateWorkspace: jest.fn().mockResolvedValue(workspace),
      deleteWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const userWorkspaceService = {
      addUserToWorkspaceIfUserNotInWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
      checkUserWorkspaceExists: jest.fn((userId: string) =>
        Promise.resolve({ id: `membership-${userId}` }),
      ),
    };
    const userRoleService = {
      assignRoleToManyUserWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const workflowRepository = {
      find: jest.fn().mockResolvedValue([{ id: 'workflow-version-1' }]),
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((callback: () => Promise<void>) =>
        callback(),
      ),
      getRepository: jest.fn().mockResolvedValue(workflowRepository),
    };
    const workflowTriggerWorkspaceService = {
      deactivateWorkflowVersion: jest.fn().mockResolvedValue(true),
    };
    const command = new BootstrapDemoWorkspaceCommand(
      workspaceRepository as never,
      userRepository as never,
      keyValuePairRepository as never,
      roleRepository as never,
      signInUpService as never,
      workspaceService as never,
      userWorkspaceService as never,
      userRoleService as never,
      globalWorkspaceOrmManager as never,
      workflowTriggerWorkspaceService as never,
    );
    return {
      command,
      workspaceRepository,
      keyValuePairRepository,
      signInUpService,
      workspaceService,
      userWorkspaceService,
      userRoleService,
      workflowRepository,
      workflowTriggerWorkspaceService,
    };
  };

  it('defaults to a read-only plan', async () => {
    const context = setup();
    await context.command.run([], { owner: ownerOptions });
    expect(context.signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
    expect(context.workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('creates once and provisions both owners as Admin', async () => {
    const context = setup();
    await context.command.run([], { execute: true, owner: ownerOptions });
    expect(context.signInUpService.signUpOnNewWorkspace).toHaveBeenCalledTimes(
      1,
    );
    expect(
      context.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
    ).toHaveBeenCalledTimes(2);
    expect(
      context.userRoleService.assignRoleToManyUserWorkspace,
    ).toHaveBeenCalledTimes(2);
    expect(context.keyValuePairRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.id }),
    );
    expect(
      context.workflowTriggerWorkspaceService.deactivateWorkflowVersion,
    ).toHaveBeenCalledWith('workflow-version-1', workspace.id);
  });

  it('reconciles a marked workspace without creating another', async () => {
    const context = setup({ existingWorkspace: workspace });
    await context.command.run([], { execute: true, owner: ownerOptions });
    expect(context.signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
    expect(
      context.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
    ).toHaveBeenCalledTimes(2);
  });

  it('rejects an unmarked DEMO name collision', async () => {
    const context = setup({ existingWorkspace: workspace, marker: null });
    await expect(
      context.command.run([], { execute: true, owner: ownerOptions }),
    ).rejects.toThrow('name collision');
    expect(
      context.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('removes a newly created workspace when owner reconciliation fails', async () => {
    const context = setup();
    context.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace.mockRejectedValueOnce(
      new Error('role failure'),
    );
    await expect(
      context.command.run([], { execute: true, owner: ownerOptions }),
    ).rejects.toThrow('role failure');
    expect(context.workspaceService.deleteWorkspace).toHaveBeenCalledWith(
      workspace.id,
    );
  });

  it('removes a newly activated workspace when marker creation fails', async () => {
    const context = setup();
    context.keyValuePairRepository.insert.mockRejectedValueOnce(
      new Error('marker failure'),
    );

    await expect(
      context.command.run([], { execute: true, owner: ownerOptions }),
    ).rejects.toThrow('marker failure');
    expect(context.workspaceService.deleteWorkspace).toHaveBeenCalledWith(
      'pending',
    );
  });
});
