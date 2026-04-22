# net-units

If you've ever divided bytes by milliseconds and gotten a nonsense number, or passed a raw `number` where a duration was expected, this library turns that into a compile error. Six branded numeric types for **time**, **data size**, and **throughput** — dimensionally-safe primitives for streaming, I/O, rate estimation, and scheduling, at zero runtime cost.

## The six types

| Type             | Unit       | Sign          | Purpose                                             | Factory example          |
|------------------|------------|---------------|-----------------------------------------------------|--------------------------|
| `TimeDelta`      | ms         | signed        | Durations, timeouts, intervals, jitter, RTT         | `TimeDelta.fromMs(500)`  |
| `Timestamp`      | ms         | absolute      | Event times, window boundaries, last-seen markers   | `clock.now()`            |
| `DataSize`       | bytes      | non-negative  | Payloads, buffer levels, queue depth                | `DataSize.fromMB(8)`     |
| `DataSizeDelta`  | bytes      | signed        | Signed byte differences, queue-depth changes        | `DataSize.diff(a, b)`    |
| `DataRate`       | bits/sec   | non-negative  | Throughput estimates, configured limits             | `DataRate.fromMbps(10)`  |
| `DataRateDelta`  | bits/sec   | signed        | Rate changes, correction signals, derivatives       | `DataRate.diff(a, b)`    |

Each is a plain JS `number` with a phantom brand visible only to TypeScript.

## The operator algebra

```
Timestamp.diff(later, earlier)       Timestamp − Timestamp      → TimeDelta        (emphasizes sign)
Timestamp.elapsed(from, to)          Timestamp → Timestamp      → TimeDelta        (same math as diff; reads left-to-right)
Timestamp.add(t, d)                  Timestamp + TimeDelta      → Timestamp
Timestamp.sub(t, d)                  Timestamp − TimeDelta      → Timestamp

DataSize.per(size, duration)         DataSize  / TimeDelta      → DataRate         ("size per duration")
DataSize.at(size, rate)              DataSize  / DataRate       → TimeDelta        ("size at a rate")
DataRate.over(rate, duration)        DataRate  × TimeDelta      → DataSize         ("rate over a duration"; bandwidth-delay product)
DataSize.diff(a, b)                  DataSize  − DataSize       → DataSizeDelta    (signed)
DataRate.diff(a, b)                  DataRate  − DataRate       → DataRateDelta    (signed)

DataSizeDelta.per(delta, duration)   DataSizeDelta / TimeDelta  → DataRateDelta    (signed)
DataRateDelta.over(delta, duration)  DataRateDelta × TimeDelta  → DataSizeDelta    (signed)
```

The compiler knows every arrow. Mixing units fails to type-check; forgetting a conversion fails to type-check; the result of `DataSize / TimeDelta` is inferred as `DataRate` with no annotation needed.

```ts
const size = DataSize.fromMB(4);
const time = TimeDelta.fromMs(250);
const rate = DataSize.per(size, time);   // DataRate — inferred
DataRate.format(rate);                   // "128 Mbps"
```

And the compiler rejects the mistakes you'd actually make:

```ts
// ❌ Wrong argument order — per(size, duration), not per(duration, size)
DataSize.per(TimeDelta.fromMs(500), DataSize.fromMB(1));
//           ~~~~~~~~~~~~~~~~~~~~~
// Argument of type 'TimeDelta' is not assignable to parameter of type 'DataSize'.

// ❌ Raw number where a typed quantity is expected
const timeout: TimeDelta = 500;
//    ~~~~~~~
// Type 'number' is not assignable to type 'TimeDelta'.

// ❌ Arithmetic with a raw operator strips the brand
const bad: DataRate = size / time;
//    ~~~
// Type 'number' is not assignable to type 'DataRate'.
```

- **Zero runtime cost.** Every quantity is a plain JavaScript `number` at runtime. No allocations, no GC pressure, no wrapper objects. The brands live entirely in the type system. Class-based wrappers benchmarked 2-6× slower because of allocation.
- **One mental model.** Each quantity has a predictable module surface: factories (`fromMs`, `fromKB`, ...), accessors (`toMs`, `toKB`, ...), predicates (`isValid`, `isZero`, ...), arithmetic, and `format()`.
- **Testable timing.** A `Clock` abstraction pairs `PerfClock` (production, `performance.now()`) with `MockClock` (deterministic test time).
- **Fail-loud sentinels.** `NOT_INIT` is `NaN`, not a magic value. It poisons arithmetic, fails all comparisons, and surfaces bugs at the first threshold check rather than leaking phantom values.

---

## Install

```sh
npm install net-units
```

Requires TypeScript for full benefit. Ships ESM and CJS.

---

## Quick start

```ts
import {
  Timestamp, TimeDelta, DataSize, DataRate,
  PerfClock,
} from "net-units";

const clock = new PerfClock();

// --- Time an operation -----------------------------------------------------
const t0 = clock.now();
await doWork();
const elapsed = Timestamp.elapsed(t0, clock.now());   // TimeDelta
console.log(`work took ${TimeDelta.format(elapsed)}`); // "work took 1.2s"

// --- Measure throughput ----------------------------------------------------
const payload = DataSize.fromMB(8);
const rate = DataSize.per(payload, elapsed);           // DataRate
console.log(`throughput: ${DataRate.format(rate)}`);   // "throughput: 53.3 Mbps"

// --- Predict transfer time -------------------------------------------------
const next = DataSize.fromMB(32);
const eta = DataSize.at(next, rate);                   // TimeDelta
console.log(`eta: ${TimeDelta.format(eta)}`);          // "eta: 4.8s"
```

---

## Core concepts

### Branded types and the zero-cost claim

```ts
declare const __td: unique symbol;
export type TimeDelta = number & { readonly [__td]: true };
```

That brand exists only at type-check time. At runtime a `TimeDelta` is a `number`. Every operation compiles to the same code you would have written by hand:

```ts
TimeDelta.add(a, b)           // compiles to: a + b
DataSize.per(size, duration)  // compiles to: size * 8000 / duration
```

Class-based wrappers were benchmarked during design and ran 3-10× slower because of allocation. Branded types carry the same safety guarantees without that cost.

### Non-negative types and their Deltas

`DataSize` and `DataRate` are non-negative by invariant. Operations that could push them below zero come in **two forms** so you can pick the semantic that fits:

```ts
// "Subtract, expecting a non-negative result."
// Returns NOT_INIT if subtrahend > minuend. Surfaces the bug.
DataSize.sub(bufferLevel, drained);      // DataSize

// "Signed difference."
// Always returns the signed delta type. Use when negative is valid.
DataSize.diff(bufferLevel, drained);     // DataSizeDelta
```

This split mirrors `Timestamp` / `TimeDelta`: an absolute or non-negative type paired with a signed difference type.

Converting between the two:

```ts
DataSizeDelta.fromSize(size)             // always safe (widening)
DataSize.fromDelta(delta)                // NOT_INIT if delta < 0
```

Delta types carry the **full signed arithmetic surface**: `add`, `sub`, `scale` (any factor), `abs`, `negate`. Non-negative types expose a minimal, invariant-preserving surface: `add`, `sub` (NaN on underflow), `scale` (NaN on negative factor), plus the cross-type operators above.

### `NOT_INIT`, `NaN`, and fail-loud propagation

Every type exposes `NOT_INIT`, and it is always `NaN`:

```ts
TimeDelta.NOT_INIT    // NaN
DataSize.NOT_INIT     // NaN
```

**Why `NaN` and not a magic number?**

1. NaN poisons arithmetic — any operation with a NaN operand returns NaN. A single forgotten initialization cannot silently produce phantom timestamps or bogus rates.
2. NaN fails all comparisons — `NaN > x`, `NaN < x`, `NaN === NaN` are all false. Threshold checks reject it naturally.
3. NaN propagates through `clamp`, `min`, `max`. If `NOT_INIT` leaks in, you see `NaN` at the first log line, not a zero that looks plausible.

The same sentinel is used for invariant violations on non-negative types:

```ts
DataSize.sub(a, b)                // NaN if b > a
DataSize.scale(s, -0.5)           // NaN (negative factor)
DataSize.per(size, negativeTime)  // NaN (invariant violation on DataRate)
```

Validate presence with `isValid`:

```ts
if (!TimeDelta.isValid(d)) {
  // handle missing value
}
```

Arithmetic otherwise follows IEEE 754 — `NaN` propagates, division by zero yields `±Infinity`, and signed Delta operations apply those rules without guards. Non-negative types additionally guard inputs that would violate their invariant (negative duration, negative factor) and return `NaN`.

**Gotcha.** Because `NaN !== NaN` by IEEE 754, `TimeDelta.eq(NOT_INIT, NOT_INIT)` is `false`. `eq` is not for checking presence — it's for comparing values. Use `isValid` for presence.

### SI (decimal) vs IEC (binary) prefixes

Both conventions are offered with unambiguous names. Networks and files are decimal; memory is binary.

```ts
DataSize.fromKB(1)    // 1000 B     SI decimal
DataSize.fromKiB(1)   // 1024 B     IEC binary
DataSize.fromMB(1)    // 1_000_000
DataSize.fromMiB(1)   // 1_048_576
```

Rate prefixes are decimal-only (`fromKbps`, `fromMbps`, `fromGbps`) — universal convention in networking.

Casing matters: capital **B** = byte, lowercase **b** = bit, **i** indicates IEC binary.

### The `Clock` abstraction

```ts
interface Clock {
  now(): Timestamp;
  schedule(delay: TimeDelta, cb: () => void): Cancel;
}
```

Two implementations ship:

- **`PerfClock`** — `performance.now()` + `setTimeout`. Use in production.
- **`MockClock`** — time advances only when you call `advance()`. Callbacks fire in timestamp order (stable FIFO at equal times). Re-entrant scheduling during `advance()` is honored. Use in tests.

Swap by passing a `Clock` into any timing-sensitive component. See [Example: testable token bucket](#example-testable-token-bucket) below.

---

## API surface

Every quantity module follows the same rough layout:

- **Constants** — `ZERO` (where meaningful), `INF`, `NEG_INF` (signed only), `NOT_INIT`
- **Factories** — `fromMs`, `fromKB`, `fromBytes`, ...
- **Accessors** — `toMs`, `toKB`, `toBytes`, ...
- **Predicates** — `isValid`, `isFinite`, `isZero`, `isPositive` (signed only), `isNegative` (signed only)
- **Comparison** — `gt`, `gte`, `lt`, `lte`, `eq`
- **Arithmetic** — `add`, `sub`, `scale`, `negate`/`abs` (signed only), `ratio`, `min`, `max`, `clamp`
- **Cross-type** — `diff`, `per`, `at`, `over` (where dimensionally meaningful)
- **Formatting** — `format()`

Reading an API for the first time, start with the `fromX` and `toX` rows and the cross-type operations. Everything else is conventional.

---

## Examples

### Running average of a rate signal

```ts
import { DataRate, DataRateDelta } from "net-units";

let smooth = DataRate.fromMbps(10);   // seed

function observe(sample: DataRate, alpha: number) {
  // smooth += alpha * (sample − smooth)
  const delta = DataRate.diff(sample, smooth);              // DataRateDelta
  const step = DataRateDelta.scale(delta, alpha);           // signed scale
  smooth = DataRate.add(smooth, DataRate.fromDelta(step));  // NaN if step < 0
}
```

Here the compiler forced us to acknowledge the sign-crossing. If we wanted negative steps to be allowed (they should be here), we widen through `DataRateDelta` the whole way:

```ts
import { DataRate, DataRateDelta } from "net-units";

let smooth = DataRateDelta.fromRate(DataRate.fromMbps(10));

function observe(sampleBps: DataRate, alpha: number) {
  const sample = DataRateDelta.fromRate(sampleBps);
  const delta = DataRateDelta.sub(sample, smooth);
  smooth = DataRateDelta.add(smooth, DataRateDelta.scale(delta, alpha));
}
```

The type system made a real question visible: *is a negative correction legitimate here?* It is — and the code now says so explicitly. This is the payoff of the non-negative/Delta split.

### Exponential backoff with bounds

```ts
import { TimeDelta } from "net-units";

const MIN = TimeDelta.fromMs(100);
const MAX = TimeDelta.fromSec(30);

function nextDelay(attempt: number): TimeDelta {
  const raw = TimeDelta.scale(MIN, 2 ** attempt);
  return TimeDelta.clamp(raw, MIN, MAX);
}
```

`scale` accepts any numeric factor; `clamp` keeps the result typed and inside bounds.

### Example: testable token bucket

```ts
import {
  DataSize, DataRate, TimeDelta, Timestamp,
  type Clock,
} from "net-units";

class Throttle {
  private tokens: DataSize;
  private last: Timestamp;
  constructor(private clock: Clock, private rate: DataRate, private cap: DataSize) {
    this.tokens = cap;
    this.last = clock.now();
  }

  tryConsume(n: DataSize): boolean {
    const now = this.clock.now();
    const gained = DataRate.over(this.rate, Timestamp.elapsed(this.last, now));
    this.tokens = DataSize.min(DataSize.add(this.tokens, gained), this.cap);
    this.last = now;

    if (DataSize.lt(this.tokens, n)) return false;
    this.tokens = DataSize.sub(this.tokens, n);  // safe, guarded above
    return true;
  }
}
```

Test:

```ts
import { MockClock, DataRate, DataSize } from "net-units";

const clock = new MockClock(0);
const t = new Throttle(clock, DataRate.fromKbps(80), DataSize.fromKB(2));

expect(t.tryConsume(DataSize.fromKB(2))).toBe(true);
expect(t.tryConsume(DataSize.fromKB(1))).toBe(false);  // bucket empty

clock.advance(TimeDelta.fromMs(100));                  // +1 KB refill
expect(t.tryConsume(DataSize.fromKB(1))).toBe(true);
```

A complete worked example — a pacer that schedules packets at the exact moment tokens become sufficient — lives in [`examples/paced-sender.ts`](examples/paced-sender.ts), with scenarios in [`examples/demo.ts`](examples/demo.ts).

### Deterministic tests without `sinon.useFakeTimers()`

```ts
import { MockClock, TimeDelta } from "net-units";

test("debouncer collapses bursts to a single call", () => {
  const clock = new MockClock(0);
  const calls: number[] = [];
  const d = debounce(clock, TimeDelta.fromMs(50), () => calls.push(clock.now()));

  d(); d(); d();
  clock.advance(TimeDelta.fromMs(30));   // still within debounce window
  d();
  clock.advance(TimeDelta.fromMs(60));   // past the last d() by 60ms
  expect(calls).toEqual([90]);
});
```

`MockClock.advance` fires due callbacks in order, including any callbacks re-scheduled during the advance itself.

---

## Tips

**`format()` for humans, `toX()` for machines.** `DataSize.format(s)` renders `"4.2 MB"`. For metrics, logs you will grep, or anything a program reads, export the raw numeric via `DataSize.toBytes(s)` / `TimeDelta.toMs(d)`.

**`!(d >= 0)` catches negative *and* `NaN` in one idiom.** The library uses it internally; it is the terse way to guard invariants where you would otherwise need two checks. `d < 0 || Number.isNaN(d)` is the explicit form.

**Widening signed → non-negative is deliberate and explicit.** Use `DataSize.fromDelta(d)` when you *expect* a non-negative result and want a `NOT_INIT` if you are wrong. Use `DataSizeDelta.fromSize(s)` when you *know* the value is non-negative and just need it in the signed world.

**`Timestamp` has no `ZERO`.** Epoch is arbitrary — there is no universally meaningful "zero timestamp". If you need a sentinel, use `Timestamp.NOT_INIT`.

**`MockClock.advance(TimeDelta.ZERO)` drains synchronously-schedulable work.** Useful when a system-under-test schedules a zero-delay callback during a function call and you want to flush it.

**`isFinite` vs `isValid`.** `isValid` rejects `NaN` only; `Infinity` is a valid value. `isFinite` rejects both `NaN` and `±Infinity`. Use `isValid` to check for presence; use `isFinite` when you need a concrete number for arithmetic that cannot tolerate infinities.

---

## Design notes

### Heritage

The type taxonomy (non-negative absolute paired with a signed delta) and the operator set (`per`, `at`, `over`, `diff`, `elapsed`) are lifted from libwebrtc's `rtc_base/units/`, where they power congestion control, pacing, and bandwidth estimation at Chrome scale. Two JS adaptations: branded numbers instead of class wrappers (classes allocate, primitives don't), and `NaN` as the `NOT_INIT` sentinel (it propagates through arithmetic and fails comparisons where libwebrtc uses `PlusInfinity()` or explicit validity flags).

### Why ms and bits/sec internally?

`performance.now()` returns milliseconds — zero conversion at the most common entry point. `DataRate` uses bits/sec because MTU, RFCs, browser APIs, and ISPs all speak bits/sec. The accessors (`toSec`, `toBytesPerSec`, `toMbps`) bridge to whatever your call site prefers.

### Why no runtime validation in factories?

The library's claim is compile-time safety at zero runtime cost. `TimeDelta.fromMs(NaN)` returns `NOT_INIT` and propagates; `DataSize.fromBytes(-1)` returns a negative size that NaN-propagates on the first cross-type operation. If you need strict-mode validation at a boundary, wrap once:

```ts
const safeFromMs = (n: number): TimeDelta => {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`bad ms: ${n}`);
  return TimeDelta.fromMs(n);
};
```

### Why two shapes for sign-crossing operations (`sub` and `diff`)?

The code you write almost always knows whether the answer ought to be non-negative. Encoding that knowledge in the call site — `sub` for "expecting non-negative", `diff` for "signed, don't care" — turns a class of bugs into `NaN`s that surface at the first threshold check. Libraries that return silently-clamped zeros, or that always return signed and leave you to check, make this invariant harder to see in code review.

### Why branded types over tagged classes?

Classes allocate. A `new DataSize(1024)` in a hot loop produces garbage that a `number` does not. Brands give equivalent safety at the type-checker with zero runtime shape.

### Why is the formatter so minimal?

Formatting is a *presentation* concern that changes more often than the *algebra*. Keeping the core allocation-light means it is safe to use in hot paths and in metrics callbacks. Locale-aware, precision-tunable, and threshold-tunable output are intentionally out of scope — call the accessor (`toMs`, `toBytes`, `toBps`) and pass the number to your formatter of choice.

---

## Safe operating ranges (float64)

- **`TimeDelta`/`Timestamp`:** integers exact up to 2⁵³ — in milliseconds, ~285 million years.
- **`DataSize`:** exact up to 2⁵³ bytes (~9 PB).
- **`DataRate`:** exact up to 2⁵³ bps (~9 Pbps).
- **Intermediate products** in `DataSize.per` and `DataRate.over` approach 2⁵³ around multi-TB or multi-Pb workloads. Precision loss at those extremes is silent. For bulk analytics at that scale, reason in reduced precision or split the computation.

---

## License

MIT