export default {
  // Test environment
  testEnvironment: 'node',
  
  // Module transformation
  transform: {},
  
  // Module resolver for ES modules
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js',
    '**/__tests__/**/*.js',
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'html',
    'json',
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  
  // Files to collect coverage from
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/**/*.config.js',
    '!src/**/*.mock.js',
    '!src/**/index.js',
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Test suites configuration
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      coverageDirectory: 'coverage/unit',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      coverageDirectory: 'coverage/integration',
      timeout: 30000,
    },
    {
      displayName: 'contract',
      testMatch: ['<rootDir>/tests/contract/**/*.test.js'],
      coverageDirectory: 'coverage/contract',
      timeout: 30000,
    },
  ],
  
  // Global test timeout
  testTimeout: 10000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Error handling
  errorOnDeprecated: true,
  
  // Maximum worker processes
  maxWorkers: '50%',
  
  // Cache directory
  cacheDirectory: '<rootDir>/.jest-cache',
  
  // Global variables
  globals: {
    __TEST__: true,
  },
  
  // Module directories
  moduleDirectories: ['node_modules', 'src'],
  
  // Notify mode
  notify: false,
  
  // Bail on first test failure (for CI)
  bail: process.env.CI ? 1 : 0,
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,
}