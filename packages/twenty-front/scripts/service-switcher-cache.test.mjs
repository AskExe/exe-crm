import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const hash = createHash('sha256').update(readFileSync(new URL('public/exe-service-switcher.js', root))).digest('hex').slice(0, 16);
const wrapper = readFileSync(new URL('src/modules/ui/layout/page/components/ExeServiceSwitcher.tsx', root), 'utf8');
assert.ok(wrapper.includes(`/exe-service-switcher.js?v=${hash}`), 'Update the consumed script fingerprint after switcher edits');
console.log('Consumed switcher fingerprint matches public asset');
