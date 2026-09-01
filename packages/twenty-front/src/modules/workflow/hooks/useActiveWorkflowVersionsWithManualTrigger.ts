import { isGlobalManualTrigger } from '@/command-menu-item/record/utils/isGlobalManualTrigger';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import {
  type ManualTriggerWorkflowVersion,
  type Workflow,
} from '@/workflow/types/Workflow';
import { isDefined } from 'twenty-shared/utils';
import { PermissionFlagType } from '~/generated-metadata/graphql';

export const useActiveWorkflowVersionsWithManualTrigger = ({
  objectMetadataItem,
  skip,
}: {
  objectMetadataItem?: EnrichedObjectMetadataItem;
  skip?: boolean;
}) => {
  // Bug demo-perms: the server denies ALL object-record reads on workflow
  // objects (workflow, workflowVersion, workflowRun) unless the caller's role
  // holds the WORKFLOWS permission flag or canUpdateAllSettings
  // (WorkspaceRolesPermissionsCacheService.hasWorkflowsPermissions). Roles
  // without it (e.g. the seeded "Member" / "Exe Managed Member" roles) got two
  // "User does not have permission" toasts on every record page load, because
  // the command-menu providers mount this hook unconditionally. The frontend
  // `permissionFlags` mirror the server's exact gate (they fold
  // canUpdateAllSettings into every flag), so skipping on !WORKFLOWS keeps
  // this hook consistent with what the server would allow — it never fires a
  // doomed query for users the server is about to 403.
  const canReadWorkflowObjects = useHasPermissionFlag(
    PermissionFlagType.WORKFLOWS,
  );

  const filters = [
    {
      status: {
        eq: 'ACTIVE',
      },
    },
    {
      trigger: {
        like: `%"type": "MANUAL"%`,
      },
    },
  ];

  if (isDefined(objectMetadataItem)) {
    filters.push({
      trigger: {
        like: `%"objectNameSingular": "${objectMetadataItem?.nameSingular}"%`,
      },
    });
  }

  const { records } = useFindManyRecords<
    Pick<
      ManualTriggerWorkflowVersion,
      'id' | '__typename' | 'status' | 'workflowId' | 'trigger'
    > & {
      workflow: Workflow;
    }
  >({
    objectNameSingular: CoreObjectNameSingular.WorkflowVersion,
    filter: {
      and: filters,
    },
    recordGqlFields: {
      id: true,
      trigger: true,
      workflowId: true,
      workflow: true,
      status: true,
    },
    skip: skip || !canReadWorkflowObjects,
  });

  // TODO: refactor when we can use 'not like' in the RawJson filter
  if (!isDefined(objectMetadataItem)) {
    return {
      records: records.filter(
        (record) =>
          record.status === 'ACTIVE' &&
          isDefined(record.trigger) &&
          isGlobalManualTrigger(record.trigger),
      ),
    };
  }

  return { records: records.filter((record) => isDefined(record.workflow)) };
};
