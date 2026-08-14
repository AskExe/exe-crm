import { scaffoldIntegrationTest } from '@/utils/test-template';
import * as fs from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';

describe('scaffoldIntegrationTest', () => {
  let testAppDirectory: string;
  let sourceFolderPath: string;

  beforeEach(async () => {
    testAppDirectory = join(
      tmpdir(),
      `test-twenty-app-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    sourceFolderPath = join(testAppDirectory, 'src');
    await fs.ensureDir(sourceFolderPath);

    await fs.writeJson(join(testAppDirectory, 'tsconfig.json'), {
      compilerOptions: {
        paths: { 'src/*': ['./src/*'] },
      },
      exclude: ['node_modules', 'dist', '**/*.integration-test.ts'],
    });
  });

  afterEach(async () => {
    if (testAppDirectory && (await fs.pathExists(testAppDirectory))) {
      await fs.remove(testAppDirectory);
    }
  });

  describe('integration test file', () => {
    it('should create app-install.integration-test.ts with correct structure', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const testPath = join(
        sourceFolderPath,
        '__tests__',
        'app-install.integration-test.ts',
      );

      expect(await fs.pathExists(testPath)).toBe(true);

      const content = await fs.readFile(testPath, 'utf8');

      expect(content).toContain(
        "import { appBuild, appDeploy, appInstall, appUninstall } from 'twenty-sdk/cli'",
      );
      expect(content).toContain(
        "import { MetadataApiClient } from 'twenty-client-sdk/metadata'",
      );
      expect(content).toContain(
        "import { APPLICATION_UNIVERSAL_IDENTIFIER } from 'src/application-config'",
      );
      expect(content).toContain('appBuild');
      expect(content).toContain('appDeploy');
      expect(content).toContain('appInstall');
      expect(content).toContain('appUninstall');
      expect(content).toContain('new MetadataApiClient()');
      expect(content).toContain('findManyApplications');
      expect(content).toContain('APPLICATION_UNIVERSAL_IDENTIFIER');
    });
  });

  describe('setup-test file', () => {
    it('should create setup-test.ts with SDK config bootstrap', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const setupTestPath = join(
        sourceFolderPath,
        '__tests__',
        'setup-test.ts',
      );

      expect(await fs.pathExists(setupTestPath)).toBe(true);

      const content = await fs.readFile(setupTestPath, 'utf8');

      expect(content).toContain('.twenty-sdk-test');
      expect(content).toContain('config.json');
      expect(content).toContain('process.env.TWENTY_API_URL');
      expect(content).toContain('process.env.TWENTY_API_KEY');
      expect(content).toContain('assertServerIsReachable');
    });
  });

  describe('vitest config', () => {
    it('should create vitest.config.ts with env vars and setup file', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const vitestConfigPath = join(testAppDirectory, 'vitest.config.ts');

      expect(await fs.pathExists(vitestConfigPath)).toBe(true);

      const content = await fs.readFile(vitestConfigPath, 'utf8');

      expect(content).toContain('TWENTY_API_KEY');
      expect(content).not.toContain('TWENTY_TEST_API_KEY');
      expect(content).toContain('setup-test.ts');
      expect(content).toContain('tsconfig.spec.json');
      expect(content).toContain('integration-test.ts');
    });
  });

  describe('github workflow', () => {
    it('should create .github/workflows/ci.yml with correct structure', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const workflowPath = join(
        testAppDirectory,
        '.github',
        'workflows',
        'ci.yml',
      );

      expect(await fs.pathExists(workflowPath)).toBe(true);

      const content = await fs.readFile(workflowPath, 'utf8');

      expect(content).toContain('name: CI');
      expect(content).toContain('actions/checkout@');
      expect(content).toContain('actions/setup-node@');
      expect(content).toContain('yarn install --immutable');
      expect(content).toContain('yarn twenty server start --port 2020');
      expect(content).toContain('yarn test');
      expect(content).toContain('TWENTY_API_URL: http://localhost:2020');
    });
  });

  // Security regression guard — bug 112eb501.
  //
  // The generated workflow runs inside the CUSTOMER's repository, on the
  // customer's runner, with the customer's secrets. It previously executed
  // `twentyhq/twenty/.github/actions/spawn-twenty-docker-image@main` — an
  // action owned by a third party, at a mutable branch ref — and passed it
  // `secrets.GITHUB_TOKEN`. These assertions exist so that reintroducing any
  // part of that shape turns this suite red before it can ship again.
  describe('generated workflow supply chain', () => {
    const readWorkflow = async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      return fs.readFile(
        join(testAppDirectory, '.github', 'workflows', 'ci.yml'),
        'utf8',
      );
    };

    it('should not reference any upstream Twenty organisation artifact', async () => {
      const content = await readWorkflow();

      expect(content).not.toMatch(/twentyhq\//);
      expect(content).not.toMatch(/twentycrm\//);
    });

    it('should not reference any mutable branch or floating tag', async () => {
      const content = await readWorkflow();

      expect(content).not.toMatch(/@main\b/);
      expect(content).not.toMatch(/:latest\b/);
    });

    it('should not pass any secret to any step', async () => {
      const content = await readWorkflow();

      expect(content).not.toMatch(/secrets\./);
    });

    it('should restrict the workflow token to read-only', async () => {
      const content = await readWorkflow();

      expect(content).toContain('permissions:');
      expect(content).toContain('contents: read');
    });

    it('should pin every third-party action to a 40-hex commit SHA', async () => {
      const content = await readWorkflow();

      const uses = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('uses:'));

      expect(uses.length).toBeGreaterThan(0);

      for (const use of uses) {
        expect(use).toMatch(/^uses: [^@\s]+@[0-9a-f]{40}\b/);
      }
    });
  });

  describe('tsconfig.spec.json', () => {
    it('should create tsconfig.spec.json extending the base tsconfig', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const tsconfigSpecPath = join(testAppDirectory, 'tsconfig.spec.json');

      expect(await fs.pathExists(tsconfigSpecPath)).toBe(true);

      const tsconfigSpec = await fs.readJson(tsconfigSpecPath);

      expect(tsconfigSpec.extends).toBe('./tsconfig.json');
      expect(tsconfigSpec.compilerOptions.composite).toBe(true);
      expect(tsconfigSpec.include).toContain('src/**/*.ts');
      expect(tsconfigSpec.exclude).not.toContain('**/*.integration-test.ts');
    });

    it('should add a reference to tsconfig.spec.json in tsconfig.json', async () => {
      await scaffoldIntegrationTest({
        appDirectory: testAppDirectory,
        sourceFolderPath,
      });

      const tsconfig = await fs.readJson(
        join(testAppDirectory, 'tsconfig.json'),
      );

      expect(tsconfig.references).toEqual([{ path: './tsconfig.spec.json' }]);
    });
  });
});
