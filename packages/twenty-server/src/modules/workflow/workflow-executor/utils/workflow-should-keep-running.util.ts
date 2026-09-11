import { StepStatus, type WorkflowRunStepInfos } from 'twenty-shared/workflow';

import { WorkflowRunStatus } from 'src/modules/workflow/common/standard-objects/workflow-run.workspace-entity';
import { shouldExecuteStep } from 'src/modules/workflow/workflow-executor/utils/should-execute-step.util';
import { isWorkflowIfElseAction } from 'src/modules/workflow/workflow-executor/workflow-actions/if-else/guards/is-workflow-if-else-action.guard';
import { type WorkflowIfElseResult } from 'src/modules/workflow/workflow-executor/workflow-actions/if-else/types/workflow-if-else-result.type';
import { type WorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';

export const workflowShouldKeepRunning = ({
  stepInfos,
  steps,
  triggerNextStepIds = [],
}: {
  stepInfos: WorkflowRunStepInfos;
  steps: WorkflowAction[];
  triggerNextStepIds?: string[];
}) => {
  const runningOrPendingStepExists = steps.some((step) =>
    [StepStatus.PENDING, StepStatus.RUNNING].includes(
      stepInfos[step.id]?.status,
    ),
  );

  // Trigger children have no action parent in `steps`. A deferred initial
  // branch must keep the run alive while another branch completes its retry.
  const unstartedTriggerChild = steps.some(
    (step) =>
      triggerNextStepIds.includes(step.id) &&
      stepInfos[step.id]?.status === StepStatus.NOT_STARTED &&
      shouldExecuteStep({
        step,
        steps,
        stepInfos,
        workflowRunStatus: WorkflowRunStatus.RUNNING,
      }),
  );

  const completedStepWithNotStartedExecutableChildren = steps.some((step) => {
    const stepInfo = stepInfos[step.id];
    if (
      stepInfo?.status !== StepStatus.SUCCESS &&
      stepInfo?.status !== StepStatus.FAILED_SAFELY
    ) {
      return false;
    }

    // Conditional edges live on the selected branch, not `nextStepIds`.
    // Unselected branches must never keep an otherwise finished run alive.
    const nextStepIds = isWorkflowIfElseAction(step)
      ? (step.settings.input.branches.find(
          (branch) =>
            branch.id ===
            (stepInfo.result as WorkflowIfElseResult | undefined)
              ?.matchingBranchId,
        )?.nextStepIds ?? [])
      : (step.nextStepIds ?? []);

    return nextStepIds.some((nextStepId) => {
      const nextStep = steps.find(
        (candidateStep) => candidateStep.id === nextStepId,
      );
      if (!nextStep) return false;
      return (
        stepInfos[nextStepId]?.status === StepStatus.NOT_STARTED &&
        shouldExecuteStep({
          step: nextStep,
          steps,
          stepInfos,
          workflowRunStatus: WorkflowRunStatus.RUNNING,
        })
      );
    });
  });

  return (
    runningOrPendingStepExists ||
    unstartedTriggerChild ||
    completedStepWithNotStartedExecutableChildren
  );
};
