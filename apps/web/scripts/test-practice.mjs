import { spawnSync } from "node:child_process";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL to run practice tests");
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/lib/tune-practice.integration.test.ts"], {
  env: { ...process.env, TEST_DATABASE_URL: databaseUrl }, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
