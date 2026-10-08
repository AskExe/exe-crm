import { type QueryRunner } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';

// This adds currentness checks, not SQL privileges. Only the existing private
// original-action fence can issue the workspace binding. No URL/role selector.
export async function fencePrivateWorkspaceQueries(
  runner: QueryRunner,
  fence: PrivateNativeMutationFence,
  workspaceId: string,
): Promise<() => void> {
  PrivateNativeMutationFence.assertIssued(fence);
  await fence.assertWorkspaceCurrent(workspaceId);
  if (runner.isTransactionActive || runner.isReleased)
    throw new PrivateNativeActionUnavailable();
  const original = runner.query;
  const guarded: QueryRunner['query'] = async (
    ...args: [
      query: string,
      parameters?: unknown[],
      useStructuredResult?: boolean,
    ]
  ) => {
    if (runner.query !== guarded) throw new PrivateNativeActionUnavailable();
    await fence.assertWorkspaceCurrent(workspaceId);
    const result = await Reflect.apply(original, runner, args);
    await fence.assertWorkspaceCurrent(workspaceId);
    return result;
  };
  runner.query = guarded;
  let restored = false;
  return () => {
    if (restored) throw new PrivateNativeActionUnavailable();
    restored = true;
    // Rollback/release must remain possible after revocation. The caller owns
    // this runner and restores only for its terminal transaction cleanup.
    runner.query = original;
  };
}
