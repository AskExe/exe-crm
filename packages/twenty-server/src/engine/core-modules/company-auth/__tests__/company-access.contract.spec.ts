import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { companyAccess } from '../company-access.contract';

describe('central company access contract', () => {
  it('matches the central artifact pin and all cross-product conformance cases', () => {
    const repository = resolve(__dirname, '../../../../../../..');
    const manifest = JSON.parse(
      readFileSync(resolve(repository, 'company-access.manifest.json'), 'utf8'),
    );
    const source = readFileSync(
      resolve(repository, manifest.artifacts['exe-crm'].file),
    );
    const fixtures = readFileSync(
      resolve(repository, 'tests/company-access.fixtures.json'),
    );

    expect(createHash('sha256').update(source).digest('hex')).toBe(
      manifest.artifacts['exe-crm'].sha256,
    );
    expect(createHash('sha256').update(fixtures).digest('hex')).toBe(
      manifest.fixturesSha256,
    );
    const cases: {
      name: string;
      value: unknown;
      binding: Parameters<typeof companyAccess>[1];
      accepted: boolean;
      unboundAccepted: boolean;
    }[] = JSON.parse(fixtures.toString()).cases;

    for (const item of cases) {
      expect({
        name: item.name,
        accepted: companyAccess(item.value) !== null,
      }).toEqual({ name: item.name, accepted: item.unboundAccepted });
      expect({
        name: item.name,
        accepted: companyAccess(item.value, item.binding) !== null,
      }).toEqual({ name: item.name, accepted: item.accepted });
    }
  });
});
