import { execSync } from 'node:child_process';

export const CONTAINER_NAME = 'twenty-app-dev';

/**
 * Local development server image, pinned to an immutable content digest.
 *
 * SECURITY — bug 112eb501. This reference MUST stay pinned by `@sha256:`.
 * A floating tag (`:latest`, `:16`, `@main`) is not a name for bytes, it is a
 * name for "whatever the publisher decides tomorrow" — a live channel through
 * which a third party can change the code we execute on developer machines and
 * inside CI, with no review, no PR and no signal. A digest names exact bytes
 * and cannot be repointed by anyone.
 *
 * This image is still hosted by a third party. Pinning removes the mutability,
 * not the third party. Mirroring it into an AskExe-controlled repository is
 * tracked separately; when that mirror exists, the two constants below are the
 * only lines that change, and every consumer (SDK dev server and the CI that
 * `create-twenty-app` generates) picks it up from here.
 *
 * To move the pin: resolve the digest of the tag you want and paste it here.
 *   docker buildx imagetools inspect <repo>:<tag> --format '{{.Manifest.Digest}}'
 */
export const IMAGE_REPOSITORY = 'twentycrm/twenty-app-dev';
export const IMAGE_DIGEST =
  'sha256:75f433df61e2738b0c74f4d6ff2ae1a79ccf40e143ed5a75de0bb10f452fc506';
export const IMAGE = `${IMAGE_REPOSITORY}@${IMAGE_DIGEST}`;

export const DEFAULT_PORT = 2020;

export const isContainerRunning = (): boolean => {
  try {
    const result = execSync(
      `docker inspect -f '{{.State.Running}}' ${CONTAINER_NAME}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();

    return result === 'true';
  } catch {
    return false;
  }
};

export const getContainerPort = (): number => {
  try {
    const result = execSync(
      `docker inspect -f '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' ${CONTAINER_NAME}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();

    return parseInt(result, 10) || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
};

export const containerExists = (): boolean => {
  try {
    execSync(`docker inspect ${CONTAINER_NAME}`, {
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    return true;
  } catch {
    return false;
  }
};

export const checkDockerRunning = (): boolean => {
  try {
    execSync('docker info', { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
};
