/**
 * TTL이 있고 주기적으로 만료 항목을 청소하는 in-memory 캐시(코드 리뷰 P2-2) — 예전엔
 * idCache/lastStatus가 무기한 보존돼, 미등록 기기의 음성(null) 결과가 게이트웨이 재시작
 * 전까지 계속 "미등록"으로 캐시되고, 삭제/폐기된 기기의 상태도 계속 메모리에 남았다.
 * set()마다 다른 TTL을 줄 수 있어 양성/음성 결과에 서로 다른 만료시간을 적용할 수 있다.
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
