import { AutomatedTriggerWorkspaceService } from 'src/modules/workflow/workflow-trigger/automated-trigger/automated-trigger.workspace-service';

describe('AutomatedTriggerWorkspaceService', () => {
  it('bypasses record permissions when deleting a system-managed trigger in a transaction', async () => {
    const repository = { delete: jest.fn().mockResolvedValue(undefined) };
    const manager = {
      getRepository: jest.fn().mockResolvedValue(repository),
    };
    const service = new AutomatedTriggerWorkspaceService(manager as never);
    const entityManager = {};

    await service.deleteAutomatedTrigger({
      workflowId: 'workflow-id',
      workspaceId: 'workspace-id',
      entityManager: entityManager as never,
    });

    expect(manager.getRepository).toHaveBeenCalledWith(
      'workspace-id',
      'workflowAutomatedTrigger',
      { shouldBypassPermissionChecks: true },
    );
    expect(repository.delete).toHaveBeenCalledWith(
      { workflowId: 'workflow-id' },
      entityManager,
    );
  });
});
