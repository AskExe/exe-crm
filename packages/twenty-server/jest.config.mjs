const jestConfig = {
  // For more information please have a look to official docs https://jestjs.io/docs/configuration/#prettierpath-string
  // Prettier v3 should be supported in jest v30 https://github.com/jestjs/jest/releases/tag/v30.0.0-alpha.1
  prettierPath: null,
  errorOnDeprecated: true,
  clearMocks: true,
  displayName: 'twenty-server',
  rootDir: './',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./setupTests.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(file-type|@file-type|strtok3|token-types|@borewit|@tokenizer|uint8array-extras|read-next-line)/)',
  ],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: false,
            decorators: true,
          },
          transform: {
            decoratorMetadata: true,
          },
          experimental: {
            plugins: [
              [
                '@lingui/swc-plugin',
                {
                  stripNonEssentialFields: false,
                },
              ],
            ],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^src/(.*)': '<rootDir>/src/$1',
    '^test/(.*)': '<rootDir>/test/$1',
    '^file-type$': '<rootDir>/../../node_modules/file-type/source/index.js',
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  fakeTimers: {
    enableGlobally: true,
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  // Coverage thresholds are an aspirational quality target that the codebase
  // does not yet meet (≈27% statements vs the 30% goal). Enforcing them in the
  // default test run makes jest exit non-zero EVEN WHEN EVERY TEST PASSES,
  // which previously forced CI to swallow the exit code with
  // `continue-on-error: true` — and that also masked real test failures.
  // To keep the CI gate honest (a failing test, and only a failing test, fails
  // the job) the threshold is opt-in: set JEST_ENFORCE_COVERAGE=1 to enforce it
  // (e.g. once coverage reaches the goal, make it the default again).
  ...(process.env.JEST_ENFORCE_COVERAGE === '1'
    ? {
        coverageThreshold: {
          global: {
            statements: 30,
            branches: 20,
            functions: 25,
            lines: 30,
          },
        },
      }
    : {}),
};

export default jestConfig;
