// ==========================================================================
// MockClock — deterministic in-memory Clock for tests
// ==========================================================================
//
// Time advances only when `advance()` or `set()` is called. `schedule()`
// registers callbacks that fire in timestamp order during subsequent
// `advance()` calls, with stable FIFO at equal times.
//
// Callbacks scheduled during an advance (re-entrant) are honored: if
// their firing time falls within the still-pending advance range, they
// fire within the same advance() call in correct order.
//
// The pending queue uses insertion-sort on schedule — O(n) per insert.
// Fine for typical test use (dozens of events in flight). If you run a
// simulation-style harness with thousands of scheduled callbacks, swap
// in a heap-based queue; the schedule/advance interface is stable
// enough that it's a drop-in change.
// ==========================================================================

import type { Timestamp, TimeDelta, Clock, Cancel } from "./index.js";

export class MockClock implements Clock {
    private _ms: number;
    private pending: Array<{
        at: number;
        cb: () => void;
        seq: number;
        cancelled: boolean;
    }> = [];
    private seq = 0;
    private _active = 0;

    constructor(startMs: number = 0) {
        this._ms = startMs;
    }

    now(): Timestamp {
        return this._ms as Timestamp;
    }

    schedule(delay: TimeDelta, cb: () => void): Cancel {
        const raw = delay as number;
        // Match PerfClock / setTimeout: clamp negative, NaN, non-finite to 0.
        const d = raw >= 0 ? raw : 0;
        const entry = {
            at: this._ms + d,
            cb,
            seq: this.seq++,
            cancelled: false,
        };
        // Insertion sort by (at, seq) for stable FIFO at equal times.
        let i = this.pending.length;
        while (
            i > 0 &&
            (this.pending[i - 1]!.at > entry.at ||
                (this.pending[i - 1]!.at === entry.at && this.pending[i - 1]!.seq > entry.seq))
            ) {
            i--;
        }
        this.pending.splice(i, 0, entry);
        this._active++;
        return () => {
            if (!entry.cancelled) {
                entry.cancelled = true;
                this._active--;
            }
        };
    }

    /**
     * Advance time by `d` and fire all due callbacks in timestamp order.
     * Current time is set to each callback's scheduled time before firing
     * (so `now()` inside the callback returns the scheduled time, not the
     * target). After all due callbacks fire, time is set to the final target.
     *
     * Throws RangeError if `d` is negative, NaN, or non-finite — test code
     * is exactly where fail-loud matters.
     */
    advance(d: TimeDelta): void {
        const n = d as number;
        if (!Number.isFinite(n) || n < 0) {
            throw new RangeError(
                `MockClock.advance requires a non-negative finite TimeDelta, got ${n}`,
            );
        }
        const target = this._ms + n;
        while (this.pending.length > 0 && this.pending[0]!.at <= target) {
            const next = this.pending.shift()!;
            if (next.cancelled) continue;
            next.cancelled = true;
            this._active--;
            this._ms = next.at;
            next.cb();
        }
        this._ms = target;
    }

    /** Set time directly. Does NOT fire due callbacks — use advance() for that. */
    set(t: Timestamp): void {
        this._ms = t as number;
    }

    /** Number of pending (non-cancelled, non-fired) callbacks. O(1). */
    get pendingCount(): number {
        return this._active;
    }
}
