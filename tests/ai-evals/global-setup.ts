/**
 * Runs once per `pnpm eval`, before the eval files: creates the run's shared token-usage log so the
 * ADR-010 token cap covers the whole run, not each file on its own (see token-cap.ts).
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    evalUsageFile: string;
  }
}

export default function setup(project: TestProject) {
  const file = join(tmpdir(), `productforge-eval-usage-${process.pid}-${Date.now()}.log`);
  writeFileSync(file, "");
  project.provide("evalUsageFile", file);
  return () => rmSync(file, { force: true });
}
