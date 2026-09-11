import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('release dependency compatibility', () => {
  it('preserves editor, signed XML, upload, mail, config and image behavior', () => {
    // Run the real ESM/native dependency graph outside Jest's transformed modules.
    const rootDirectory = resolve(__dirname, '../../../..');
    expect(() =>
      execFileSync(
        process.execPath,
        [
          '--test',
          resolve(rootDirectory, 'scripts/test-release-dependencies.mjs'),
        ],
        { cwd: rootDirectory, timeout: 30_000, stdio: 'inherit' },
      ),
    ).not.toThrow();
  });
});
