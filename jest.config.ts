import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@agents/(.*)$": "<rootDir>/src/agents/$1",
    "^@services/(.*)$": "<rootDir>/src/services/$1",
    "^@database/(.*)$": "<rootDir>/src/database/$1",
    "^@orchestration/(.*)$": "<rootDir>/src/orchestration/$1",
    "^@types/(.*)$": "<rootDir>/src/types/$1",
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
  },
  clearMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts", "!src/database/seed.ts"],
};

export default config;
