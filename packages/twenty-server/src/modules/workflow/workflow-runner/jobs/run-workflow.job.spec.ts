import { WorkflowLicenseDeferredError } from 'src/modules/workflow/workflow-executor/exceptions/workflow-license-deferred.error';
import { WorkflowRunStatus } from 'src/modules/workflow/common/standard-objects/workflow-run.workspace-entity';
import { RunWorkflowJob } from './run-workflow.job';

describe('Workflow license retry', () => {
  const executeFromSteps = jest.fn();
  const endWorkflowRun = jest.fn();
  const getWorkflowRunOrFail = jest.fn();
  const args = [
    {},
    {},
    { executeFromSteps },
    { endWorkflowRun, getWorkflowRunOrFail },
    {},
    {
      executeInWorkspaceContext: (callback: () => Promise<void>) => callback(),
    },
  ] as unknown as ConstructorParameters<typeof RunWorkflowJob>;
  const job = new RunWorkflowJob(...args);
  const input = {
    workflowRunId: 'run',
    workspaceId: 'workspace',
    retryStepId: 'unstarted',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    getWorkflowRunOrFail.mockResolvedValue({
      status: WorkflowRunStatus.RUNNING,
    });
  });
  it('keeps the run recoverable when a license check has been requeued', async () => {
    executeFromSteps.mockRejectedValue(new WorkflowLicenseDeferredError());
    await expect(job.handle(input)).resolves.toBeUndefined();
    expect(endWorkflowRun).not.toHaveBeenCalled();
  });
  it('resumes only the delayed step after authority recovery', async () => {
    executeFromSteps.mockResolvedValue(undefined);
    await job.handle(input);
    expect(executeFromSteps).toHaveBeenCalledWith({
      workflowRunId: 'run',
      workspaceId: 'workspace',
      stepIds: ['unstarted'],
    });
    expect(endWorkflowRun).not.toHaveBeenCalled();
  });
  it('does not revive a workflow that was stopped while waiting', async () => {
    getWorkflowRunOrFail.mockResolvedValue({
      status: WorkflowRunStatus.FAILED,
    });
    await job.handle(input);
    expect(executeFromSteps).not.toHaveBeenCalled();
  });
  it('settles cancellation without executing the deferred step', async () => {
    getWorkflowRunOrFail.mockResolvedValue({
      status: WorkflowRunStatus.STOPPING,
    });
    await job.handle(input);
    expect(executeFromSteps).toHaveBeenCalledWith({
      workflowRunId: 'run',
      workspaceId: 'workspace',
      stepIds: [],
    });
    expect(endWorkflowRun).not.toHaveBeenCalled();
  });
  it('still records definitive execution errors', async () => {
    executeFromSteps.mockRejectedValue(new Error('Action failed'));
    await expect(job.handle(input)).rejects.toThrow('Action failed');
    expect(endWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: WorkflowRunStatus.FAILED }),
    );
  });
});
