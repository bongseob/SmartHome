import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// packages/test-support/dist → repo root (packages/test-support/dist/../../.. )
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * `pnpm --filter @smarthome/db exec <cmd> <args>`를 실행한다. `packages/db`의 마이그레이션/시드는
 * 이미 워크스페이스에 빌드된 산출물(node-pg-migrate devDependency, dist/seed.js)을 그대로
 * 재사용하기 위해 pnpm의 workspace 필터를 그대로 쓴다(경로/바이너리 직접 해석 금지).
 */
export function runInDbPackage(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ["--filter", "@smarthome/db", "exec", ...args], {
      cwd: REPO_ROOT,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`pnpm --filter @smarthome/db exec ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
