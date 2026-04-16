// Registers the hooks in ./asset-stub-hooks.mjs with Node's module loader.
// Used by scripts/generateThemeCss.ts to dodge binary asset imports — see
// generateThemeCss.ts for the full rationale.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hooksUrl = pathToFileURL(resolve(__dirname, 'asset-stub-hooks.mjs'));

register(hooksUrl);
