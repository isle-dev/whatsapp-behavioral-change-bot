/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { module: 'CommonJS', esModuleInterop: true, skipLibCheck: true }
    }]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
