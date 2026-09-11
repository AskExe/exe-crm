import { StepStatus } from 'twenty-shared/workflow';

import {
  type WorkflowAction,
  WorkflowActionType,
} from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';
import { workflowShouldKeepRunning } from 'src/modules/workflow/workflow-executor/utils/workflow-should-keep-running.util';

describe('workflowShouldKeepRunning', () => {
  describe('should return true if', () => {
    it('running or pending step exists', () => {
      for (const testStatus of [StepStatus.PENDING, StepStatus.RUNNING]) {
        const steps = [
          {
            id: 'step-1',
          } as WorkflowAction,
        ];

        const stepInfos = { 'step-1': { status: testStatus } };

        expect(workflowShouldKeepRunning({ steps, stepInfos })).toBeTruthy();
      }
    });

    it('success step with not started executable children exists', () => {
      const steps = [
        {
          id: 'step-1',
          nextStepIds: ['step-2'],
        } as WorkflowAction,
        {
          id: 'step-2',
        } as WorkflowAction,
      ];

      const stepInfos = {
        'step-1': { status: StepStatus.SUCCESS },
        'step-2': { status: StepStatus.NOT_STARTED },
      };

      expect(workflowShouldKeepRunning({ steps, stepInfos })).toBeTruthy();
    });
  });

  it.each([undefined, 'other'])(
    'ignores an unselected conditional child (selection %s)',
    (matchingBranchId) => {
      const steps = [
        {
          id: 'condition',
          type: WorkflowActionType.IF_ELSE,
          settings: {
            input: {
              branches: [
                { id: 'selected', nextStepIds: ['child'] },
                { id: 'other', nextStepIds: [] },
              ],
            },
          },
        } as WorkflowAction,
        { id: 'child' } as WorkflowAction,
      ];
      expect(
        workflowShouldKeepRunning({
          steps,
          stepInfos: {
            condition: {
              status: StepStatus.SUCCESS,
              result: { matchingBranchId },
            },
            child: { status: StepStatus.NOT_STARTED },
          },
        }),
      ).toBe(false);
    },
  );

  describe('should return false', () => {
    it('workflow run only have success steps', () => {
      const steps = [
        {
          id: 'step-1',
        } as WorkflowAction,
      ];

      const stepInfos = { 'step-1': { status: StepStatus.SUCCESS } };

      expect(workflowShouldKeepRunning({ steps, stepInfos })).toBeFalsy();
    });

    it('success step with not executable not started children exists', () => {
      const steps = [
        {
          id: 'step-1',
          nextStepIds: ['step-3'],
        } as WorkflowAction,
        {
          id: 'step-2',
          nextStepIds: ['step-3'],
        } as WorkflowAction,
        {
          id: 'step-3',
        } as WorkflowAction,
      ];

      const stepInfos = {
        'step-1': { status: StepStatus.SUCCESS },
        'step-2': { status: StepStatus.FAILED },
        'step-3': { status: StepStatus.NOT_STARTED },
      };

      expect(workflowShouldKeepRunning({ steps, stepInfos })).toBeFalsy();
    });
  });
});
