// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

/**
 * In-memory sliding window. v0.1.0 is single-process by design; the interface is
 * deliberately the same shape a Redis-backed counter would implement in v0.2.0.
 */
export class SlidingWindowCounter {
  private buckets = new Map<string, number[]>();

  /** Records a hit and returns the count inside the trailing 60s window. */
  hit(key: string, now = Date.now()): number {
    const cutoff = now - 60_000;
    const kept = (this.buckets.get(key) ?? []).filter(t => t > cutoff);
    kept.push(now);
    this.buckets.set(key, kept);
    return kept.length;
  }

  count(key: string, now = Date.now()): number {
    const cutoff = now - 60_000;
    return (this.buckets.get(key) ?? []).filter(t => t > cutoff).length;
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }
}
