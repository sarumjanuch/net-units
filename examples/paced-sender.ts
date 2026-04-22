// ==========================================================================
// paced-sender — Token bucket pacer over net-units
// ==========================================================================
//
// Emits queued packets at a configured throughput, allowing bursts up
// to `capacity`. Fully decoupled from the wall clock — pass a PerfClock
// in production, a MockClock in tests.
//
// Token bucket semantics:
//   - Bucket fills at `rate` (bytes/sec equivalent of the DataRate).
//   - Bucket caps at `capacity` — idle senders do not accumulate
//     unlimited burst credit.
//   - A packet fires the instant the bucket holds ≥ packet.size tokens,
//     in FIFO order.
//
// When the head-of-line packet cannot fire yet, we schedule a wake-up
// at the exact timestamp tokens will be sufficient — no polling, no
// interval ticks.
// ==========================================================================

import {
  DataSize, DataRate, TimeDelta, Timestamp,
  type Clock, type Cancel,
} from "../src/index";

export interface Packet<T = unknown> {
  readonly size: DataSize;
  readonly payload: T;
}

export interface TokenBucketOpts {
  /** Fill rate of the bucket. */
  readonly rate: DataRate;
  /** Maximum burst size. Packets larger than this throw at enqueue. */
  readonly capacity: DataSize;
  /** Starting token count (default: full bucket). */
  readonly initialTokens?: DataSize;
}

export class TokenBucketSender<T = unknown> {
  private readonly clock: Clock;
  private readonly rate: DataRate;
  private readonly capacity: DataSize;
  private readonly send: (p: Packet<T>) => void;

  private tokens: DataSize;
  private lastRefill: Timestamp;
  private readonly queue: Packet<T>[] = [];
  private pendingCancel: Cancel | null = null;
  private closed = false;

  constructor(clock: Clock, opts: TokenBucketOpts, send: (p: Packet<T>) => void) {
    this.clock = clock;
    this.rate = opts.rate;
    this.capacity = opts.capacity;
    this.send = send;
    this.tokens = DataSize.min(opts.initialTokens ?? opts.capacity, opts.capacity);
    this.lastRefill = clock.now();
  }

  /** Queue a packet for pacing. Fires synchronously if tokens allow. */
  enqueue(p: Packet<T>): void {
    if (this.closed) return;
    if (DataSize.gt(p.size, this.capacity)) {
      throw new RangeError(
        `packet ${DataSize.format(p.size)} exceeds bucket capacity ${DataSize.format(this.capacity)}`,
      );
    }
    this.queue.push(p);
    this.pump();
  }

  /** Cancel any pending timer and drop queued packets. */
  close(): void {
    this.closed = true;
    this.pendingCancel?.();
    this.pendingCancel = null;
    this.queue.length = 0;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /** Current (refilled) token level. Handy for metrics and tests. */
  tokensAvailable(): DataSize {
    this.refill();
    return this.tokens;
  }
  private refill(): void {
    const now = this.clock.now();
    const elapsed = Timestamp.elapsed(this.lastRefill, now);
    const gained = DataRate.over(this.rate, elapsed);          // bytes accrued since last check
    this.tokens = DataSize.min(                                // clamp at capacity
      DataSize.add(this.tokens, gained),
      this.capacity,
    );
    this.lastRefill = now;
  }

  private pump(): void {
    if (this.closed) return;
    this.refill();

    while (this.queue.length > 0) {
      const head = this.queue[0]!;

      if (DataSize.gte(this.tokens, head.size)) {
        // Enough credit — fire and continue draining.
        this.tokens = DataSize.sub(this.tokens, head.size);    // safe: gated by gte
        this.queue.shift();
        this.send(head);
        continue;
      }

      // Not enough credit. Already waiting? Let the existing timer handle it.
      if (this.pendingCancel !== null) return;

      // Compute the exact moment the head packet becomes sendable:
      //   wait = deficit / rate
      const deficit = DataSize.sub(head.size, this.tokens);    // safe: gte above was false
      const wait    = DataSize.at(deficit, this.rate);

      this.pendingCancel = this.clock.schedule(wait, () => {
        this.pendingCancel = null;
        this.pump();
      });
      return;
    }
  }
}
