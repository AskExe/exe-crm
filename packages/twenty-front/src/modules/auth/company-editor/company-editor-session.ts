import { REACT_APP_COMPANY_EDITOR_ENABLED } from '~/config';

// A document is bound once. A changed cookie requires a fresh document/cache;
// an in-flight operation never adopts a different company's context.
let admittedContext: string | undefined;
let revoked = false;
let signingOut = false;
export const companyEditorSessionSigningOut = () => signingOut;
let initialization: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const companyEditorSessionReady = () =>
  Boolean(admittedContext) && !revoked;
export const subscribeCompanyEditorSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const revokeCompanyEditorSession = () => {
  revoked = true;
  for (const listener of listeners) listener();
};
export const initializeCompanyEditorSession = async () => {
  if (!REACT_APP_COMPANY_EDITOR_ENABLED) return;
  initialization ??= currentProof().then(() => undefined);
  await initialization;
};
const currentProof = async () => {
  try {
    return await loadProof();
  } catch (error) {
    revokeCompanyEditorSession();
    throw error;
  }
};
const loadProof = async () => {
  if (revoked) throw new Error('Company session changed');
  const response = await fetch('/company-session/editor', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  });
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0] !==
      'application/json' ||
    !response.body
  )
    throw new Error('Company session unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) throw new Error('Company session unavailable');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const proof: unknown = JSON.parse(new TextDecoder().decode(body));
  if (
    !proof ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    Object.keys(proof).sort().join(',') !== 'context,csrf' ||
    !('context' in proof) ||
    typeof proof.context !== 'string' ||
    !/^[a-f0-9]{64}$/.test(proof.context) ||
    !('csrf' in proof) ||
    typeof proof.csrf !== 'string' ||
    !/^[A-Za-z0-9_-]{43}\.[0-9]{10}\.[A-Za-z0-9_-]{43}$/.test(proof.csrf)
  )
    throw new Error('Company session unavailable');
  if (revoked || (admittedContext && admittedContext !== proof.context)) {
    revokeCompanyEditorSession();
    throw new Error('Company session changed');
  }
  if (!admittedContext) {
    admittedContext = proof.context;
    for (const listener of listeners) listener();
  }
  return { context: proof.context, csrf: proof.csrf };
};
export const companyEditorFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    window.location.origin,
  );
  if (
    url.origin !== window.location.origin ||
    !['/graphql', '/metadata'].includes(url.pathname) ||
    url.search ||
    init?.method !== 'POST' ||
    typeof init.body !== 'string'
  )
    throw new Error('Company request unavailable');
  const captured = await currentProof();
  const headers = new Headers(init.headers);
  headers.delete('authorization');
  for (const name of [...headers.keys()]) {
    if (
      /^(?:x-(?:auth|frappe|workspace|user|company|org|role)|forwarded)/i.test(
        name,
      )
    )
      headers.delete(name);
  }
  headers.set('Content-Type', 'application/json');
  headers.set('X-Exe-Company-Context', captured.context);
  headers.set('X-Exe-Company-Csrf', captured.csrf);
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (revoked || admittedContext !== captured.context)
    throw new Error('Company session changed');
  if ([401, 403].includes(response.status)) revokeCompanyEditorSession();
  // Apollo consumes body asynchronously; fence that boundary too.
  const originalText = response.text.bind(response);
  response.text = async () => {
    const text = await originalText();
    if (revoked || admittedContext !== captured.context)
      throw new Error('Company session changed');
    // A cookie/account switch can happen while the body is being consumed.
    // Revalidate before Apollo is allowed to publish that response.
    const latest = await currentProof();
    if (revoked || latest.context !== captured.context)
      throw new Error('Company session changed');
    return text;
  };
  return response;
};

export const beginCompanyEditorSignOut = () => {
  signingOut = true;
  revokeCompanyEditorSession();
};

export const signOutCompanyEditorSession = async () => {
  beginCompanyEditorSignOut();
  const response = await fetch('/company-session/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0] !== 'application/json'
  )
    throw new Error('Company sign-out could not be confirmed');
  if (!response.body)
    throw new Error('Company sign-out could not be confirmed');
  const reader = response.body.getReader();
  let body = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 128)
        throw new Error('Company sign-out could not be confirmed');
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    await reader.cancel();
  }
  const result: unknown = JSON.parse(body);
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    Object.keys(result).join(',') !== 'revoked' ||
    !('revoked' in result) ||
    result.revoked !== true
  )
    throw new Error('Company sign-out could not be confirmed');
};
