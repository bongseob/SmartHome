/**
 * `check()`가 truthy를 반환할 때까지 폴링한다. 비동기 MQTT 왕복(gateway 인제스트, 명령 ack)은
 * 즉시 반영되지 않으므로 통합 테스트 전반에서 재사용한다.
 */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(options.message ?? `waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
