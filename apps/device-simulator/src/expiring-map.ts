/**
 * TTL이 있고 주기적으로 만료 항목을 청소하는 in-memory 캐시(코드 리뷰 P2-2) — 예전엔 명령
 * dedup(processed) map이 무제한으로 쌓였다. 오래 실행되는 시뮬레이터일수록 처리한 commandId가
 * 계속 누적돼 메모리가 무한정 증가했다.
 */
export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly defaultTtlMs: number,
    sweepIntervalMs = defaultTtlMs,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  stop(): void {
    clearInterval(this.sweepTimer);
  }
}
