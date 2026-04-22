// ==========================================================================
// net-units — Typed units for time, data size, and throughput
// ==========================================================================
//
// Dimensionally-safe primitives for working with durations, timestamps,
// byte sizes, and bitrates. Designed for hot-path use (streaming, I/O,
// rate estimation, scheduling) where both type safety and zero runtime
// overhead matter.
//
// --------------------------------------------------------------------------
// Types & internal units
// --------------------------------------------------------------------------
//
//   TimeDelta       — signed time difference,   ms  (float64)
//   Timestamp       — absolute point in time,   ms
//   DataSize        — non-negative bytes
//   DataSizeDelta   — signed byte difference
//   DataRate        — non-negative bits/sec
//   DataRateDelta   — signed bits/sec difference
//
// --------------------------------------------------------------------------
// Non-negative types and Deltas
// --------------------------------------------------------------------------
//
// `DataSize` and `DataRate` are non-negative by invariant. Operations
// that could cross zero come in two forms:
//
//   sub   — "subtract, expecting non-negative result"
//           Returns NOT_INIT (NaN) when the result would go negative,
//           surfacing the bug at the type/value boundary.
//   diff  — "signed difference"
//           Returns the paired Delta type (DataSizeDelta / DataRateDelta)
//           for use cases where negative is a valid answer.
//
// This mirrors the `Timestamp` / `TimeDelta` split: an absolute /
// non-negative type paired with a signed difference type.
//
// Delta types carry full signed arithmetic (add, sub, scale with any
// factor, abs, negate). Non-negative types expose a minimal arithmetic
// surface — add (both operands non-negative), sub (NaN on underflow),
// scale (NaN on negative factor), plus the cross-type operators
// (per, at, over) which also guard invariant violations.
//
// Converting between forms:
//   DataSizeDelta.fromSize(s)   — always safe
//   DataSize.fromDelta(d)       — returns NOT_INIT if d < 0
//
// --------------------------------------------------------------------------
// Architecture: branded types (zero-cost at runtime)
// --------------------------------------------------------------------------
//
// Each type is a plain JS `number` at runtime with a phantom brand
// visible only to the TypeScript compiler. Compile-time dimensional
// safety, zero runtime overhead, no allocation, no GC pressure.
// Benchmarked within noise of raw number arithmetic; class wrappers
// were 2-6× slower due to allocation.
//
// --------------------------------------------------------------------------
// Dimensional algebra (enforced at compile time)
// --------------------------------------------------------------------------
//
//   Timestamp.diff(l, e)            Timestamp - Timestamp     → TimeDelta
//   Timestamp.elapsed(from, to)     Timestamp → Timestamp     → TimeDelta (unsigned view)
//   Timestamp.add(t, d)             Timestamp + TimeDelta     → Timestamp
//   Timestamp.sub(t, d)             Timestamp - TimeDelta     → Timestamp
//
//   DataSize.per(s, d)              DataSize   / TimeDelta    → DataRate
//   DataSize.at(s, r)               DataSize   / DataRate     → TimeDelta
//   DataRate.over(r, d)             DataRate   × TimeDelta    → DataSize
//   DataSize.diff(a, b)             DataSize   - DataSize     → DataSizeDelta
//   DataRate.diff(a, b)             DataRate   - DataRate     → DataRateDelta
//
//   DataSizeDelta.per(δ, d)         DataSizeDelta / TimeDelta → DataRateDelta
//   DataRateDelta.over(δ, d)        DataRateDelta × TimeDelta → DataSizeDelta
//
// --------------------------------------------------------------------------
// Sentinel strategy and arithmetic edge cases
// --------------------------------------------------------------------------
//
// NOT_INIT is NaN, not a magic number. NaN poisons arithmetic, fails
// all comparisons, and propagates through clamp. If an uninitialized
// or invariant-violating value leaks in, it produces NaN downstream
// and fails at the first threshold check — rather than silently
// creating phantom timestamps, bogus rates, or zero-divide infinities.
//
// NaN is also the return for invariant violations on non-negative
// types: DataSize.sub underflow, DataSize.scale with negative factor,
// DataSize.per with negative/NaN duration, etc.
//
// Check with: TimeDelta.isValid(d), Timestamp.isValid(t), etc.
//
// Arithmetic edge cases (IEEE 754):
//   0 / 0       → NaN         (indeterminate)
//   N / 0       → ±Infinity   (sign of N)
//   0 / N       → 0           (natural)
//   NaN op X    → NaN         (propagates)
//   Infinity op finite → ±Infinity (as IEEE 754 dictates)
//
// Signed Delta operations (DataSizeDelta.per, DataRateDelta.over)
// follow IEEE 754 without guards: negative duration flips the result's
// sign, NaN propagates. This is mathematically coherent for signed
// types. Non-negative types (DataSize.per, DataRate.over) guard against
// inputs that would violate their invariant, returning NaN instead.
//
// Equality with NaN: per IEEE 754, NaN !== NaN. That means
//   TimeDelta.eq(NOT_INIT, NOT_INIT) === false
// Treat NOT_INIT as "no value" — equality between two missing values
// is not meaningful. Use isValid() to check for presence.
//
// --------------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------------
//
// Each quantity type has a default format() method for human-readable
// output. Formatters auto-scale to the most compact unit:
//
//   TimeDelta.format(...)   →  "500ms" | "1.5s" | "2m 30s" | "1h 15m"
//   DataSize.format(...)    →  "1.5 KB"  | "2.3 MB"   (SI default)
//   DataSize.format(s, { binary: true })
//                           →  "1.5 KiB" | "2.3 MiB"  (IEC)
//   DataRate.format(...)    →  "1.5 Kbps" | "2.3 Mbps"
//
// Signed Delta types format with a leading "-" for negatives. These
// are deliberately minimal — if you need locale-aware output, custom
// thresholds, or tunable precision, wrap the numeric accessor
// (toBytes, toMs, etc.) with your preferred formatter.
//
// --------------------------------------------------------------------------
// Internal unit rationale
// --------------------------------------------------------------------------
//
// Time in milliseconds:
//   performance.now() returns ms — zero conversion at the most common
//   entry point. Float64 represents integers exactly up to 2^53, which
//   in ms is ~285 million years.
//
// DataSize in bytes, DataRate in bits/sec: matches MTU, file size,
// RFCs, browser APIs, and ISP conventions.
//
// Safe operating ranges (float64):
//   - DataSize: exact up to 2^53 bytes (~9 PB).
//   - DataRate: exact up to 2^53 bps (~9 Pbps).
//   - Intermediate multiplications in DataSize.per / DataRate.over
//     approach 2^53 around multi-TB/Pb workloads. Precision loss at
//     those extremes is silent — use reduced-precision reasoning if
//     you work with bulk analytics, not just streaming.
//
// --------------------------------------------------------------------------
// Naming: SI vs IEC prefixes
// --------------------------------------------------------------------------
//
// SI decimal (powers of 1000):  fromKB / fromMB / fromGB   (bytes)
//                               fromKbps / fromMbps / fromGbps  (bits/s)
// IEC binary (powers of 1024):  fromKiB / fromMiB / fromGiB  (bytes)
//
// Case matters: capital B = byte, lowercase b = bit, "i" indicates IEC
// binary. Both conventions exist — files/networks are decimal, memory
// is binary — so both are offered with unambiguous names. Rate
// prefixes are decimal-only, matching universal networking convention.
//
// --------------------------------------------------------------------------
// Runtime validation
// --------------------------------------------------------------------------
//
// Factories perform no runtime validation. `TimeDelta.fromMs(NaN)`
// happily returns NOT_INIT; `DataSize.fromBytes(-1)` returns negative
// bytes that will NaN-propagate on first arithmetic. This is
// deliberate — the library's claim is compile-time safety at zero
// runtime cost. For strict-mode inputs, wrap at your boundary:
//
//   const safeFromMs = (n: number): TimeDelta => {
//     if (!Number.isFinite(n) || n < 0) throw new RangeError("bad ms");
//     return TimeDelta.fromMs(n);
//   };
//
// ==========================================================================
// --------------------------------------------------------------------------
// Conversion constants
// --------------------------------------------------------------------------
const BITS_PER_BYTE = 8;
const MS_PER_SEC = 1000;
// SI decimal (powers of 1000) — applies to both byte and bit-rate prefixes.
const SI_K = 1000;
const SI_M = 1000 * 1000;
const SI_G = 1000 * 1000 * 1000;
// IEC binary (powers of 1024) — byte sizes only.
const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
// --------------------------------------------------------------------------
// Type declarations (forward)
// --------------------------------------------------------------------------
declare const __td: unique symbol;
declare const __ts: unique symbol;
declare const __ds: unique symbol;
declare const __dsd: unique symbol;
declare const __dr: unique symbol;
declare const __drd: unique symbol;
export type TimeDelta     = number & { readonly [__td]: true };
export type Timestamp     = number & { readonly [__ts]: true };
export type DataSize      = number & { readonly [__ds]: true };
export type DataSizeDelta = number & { readonly [__dsd]: true };
export type DataRate      = number & { readonly [__dr]: true };
export type DataRateDelta = number & { readonly [__drd]: true };
// --------------------------------------------------------------------------
// Internal formatting helpers
// --------------------------------------------------------------------------
function fmtSentinel(n: number): string | null {
    if (Number.isNaN(n)) return "NaN";
    if (n === Infinity) return "+Infinity";
    if (n === -Infinity) return "-Infinity";
    return null;
}
// Adaptive precision: 2 decimals below 10, 1 below 100, 0 otherwise.
function fmtScaled(v: number): string {
    if (v < 10) return v.toFixed(2);
    if (v < 100) return v.toFixed(1);
    return v.toFixed(0);
}
function fmtTimeMs(n: number): string {
    const sentinel = fmtSentinel(n);
    if (sentinel !== null) return sentinel;
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (a < 1) return `${sign}${a.toFixed(2)}ms`;
    if (a < 1000) return `${sign}${fmtScaled(a)}ms`;
    if (a < 60_000) return `${sign}${fmtScaled(a / 1000)}s`;
    if (a < 3_600_000) {
        const m = Math.floor(a / 60_000);
        const s = Math.round((a % 60_000) / 1000);
        return s ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
    }
    const h = Math.floor(a / 3_600_000);
    const m = Math.round((a % 3_600_000) / 60_000);
    return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}
function fmtBytes(n: number, binary: boolean): string {
    const sentinel = fmtSentinel(n);
    if (sentinel !== null) return sentinel;
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    const k = binary ? KIB : SI_K;
    const m = binary ? MIB : SI_M;
    const g = binary ? GIB : SI_G;
    const kU = binary ? "KiB" : "KB";
    const mU = binary ? "MiB" : "MB";
    const gU = binary ? "GiB" : "GB";
    if (a < k) return `${sign}${a.toFixed(0)} B`;
    if (a < m) return `${sign}${fmtScaled(a / k)} ${kU}`;
    if (a < g) return `${sign}${fmtScaled(a / m)} ${mU}`;
    return `${sign}${fmtScaled(a / g)} ${gU}`;
}
function fmtBps(n: number): string {
    const sentinel = fmtSentinel(n);
    if (sentinel !== null) return sentinel;
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (a < SI_K) return `${sign}${a.toFixed(0)} bps`;
    if (a < SI_M) return `${sign}${fmtScaled(a / SI_K)} Kbps`;
    if (a < SI_G) return `${sign}${fmtScaled(a / SI_M)} Mbps`;
    return `${sign}${fmtScaled(a / SI_G)} Gbps`;
}
// --------------------------------------------------------------------------
// TimeDelta — signed time difference (milliseconds)
// --------------------------------------------------------------------------
// Elapsed durations, timeouts, intervals, jitter, RTT, delay gradients.
// Signed: real-world time differences can legitimately be negative
// (out-of-order events, drift, improving delay gradients).
export const TimeDelta = {
    ZERO:     0 as TimeDelta,
    INF:      Infinity as TimeDelta,
    NEG_INF:  -Infinity as TimeDelta,
    NOT_INIT: NaN as TimeDelta,
    // --- Factories ---
    fromMs:  (ms: number) => ms as TimeDelta,
    fromSec: (s: number)  => (s * MS_PER_SEC) as TimeDelta,
    // --- Accessors ---
    toMs:  (d: TimeDelta) => d as number,
    toSec: (d: TimeDelta) => (d as number) / MS_PER_SEC,
    // --- Predicates ---
    isValid:    (d: TimeDelta) => !Number.isNaN(d),
    isFinite:   (d: TimeDelta) => Number.isFinite(d),
    isZero:     (d: TimeDelta) => d === 0,
    isPositive: (d: TimeDelta) => d > 0,
    isNegative: (d: TimeDelta) => d < 0,
    // --- Comparison ---
    /** left > right */
    gt:  (left: TimeDelta, right: TimeDelta) => left > right,
    /** left >= right */
    gte: (left: TimeDelta, right: TimeDelta) => left >= right,
    /** left < right */
    lt:  (left: TimeDelta, right: TimeDelta) => left < right,
    /** left <= right */
    lte: (left: TimeDelta, right: TimeDelta) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: TimeDelta, b: TimeDelta) => a === b,
    // --- Arithmetic ---
    add: (a: TimeDelta, b: TimeDelta) => (a + b) as TimeDelta,
    /** minuend - subtrahend */
    sub: (minuend: TimeDelta, subtrahend: TimeDelta) =>
        (minuend - subtrahend) as TimeDelta,
    scale:  (d: TimeDelta, factor: number) => (d * factor) as TimeDelta,
    abs:    (d: TimeDelta) => Math.abs(d) as TimeDelta,
    negate: (d: TimeDelta) => (-d) as TimeDelta,
    /** numerator / denominator → unitless ratio. */
    ratio: (numerator: TimeDelta, denominator: TimeDelta) =>
        (numerator as number) / (denominator as number),
    clamp: (d: TimeDelta, min: TimeDelta, max: TimeDelta) =>
        (d < min ? min : d > max ? max : d) as TimeDelta,
    min: (a: TimeDelta, b: TimeDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as TimeDelta,
    max: (a: TimeDelta, b: TimeDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as TimeDelta,
    /** Human-readable: "500ms" | "1.5s" | "2m 30s" | "1h 15m" (signed). */
    format: (d: TimeDelta) => fmtTimeMs(d as number),
} as const;
// --------------------------------------------------------------------------
// Timestamp — absolute point in time (milliseconds)
// --------------------------------------------------------------------------
// Event times, window boundaries, last-seen markers. Epoch is arbitrary
// (typically performance.now() origin). Use diff/elapsed for intervals.
//
// Note: Timestamp.sub(t, delta) can produce values before the epoch if
// delta > t. For monotonic sources (performance.now()) this is almost
// always a bug; for arbitrary epochs it's legitimate ("one minute
// before zero"). The type does not guard against it.
export const Timestamp = {
    // No ZERO: epoch is arbitrary, so 0 has no universal meaning.
    INF:      Infinity as Timestamp,
    NEG_INF:  -Infinity as Timestamp,
    NOT_INIT: NaN as Timestamp,
    // --- Factories ---
    fromMs:  (ms: number) => ms as Timestamp,
    fromSec: (s: number)  => (s * MS_PER_SEC) as Timestamp,
    // --- Accessors ---
    toMs:  (t: Timestamp) => t as number,
    toSec: (t: Timestamp) => (t as number) / MS_PER_SEC,
    // --- Predicates ---
    isValid:  (t: Timestamp) => !Number.isNaN(t),
    isFinite: (t: Timestamp) => Number.isFinite(t),
    // --- Comparison ---
    /** left > right */
    gt:  (left: Timestamp, right: Timestamp) => left > right,
    /** left >= right */
    gte: (left: Timestamp, right: Timestamp) => left >= right,
    /** left < right */
    lt:  (left: Timestamp, right: Timestamp) => left < right,
    /** left <= right */
    lte: (left: Timestamp, right: Timestamp) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: Timestamp, b: Timestamp) => a === b,
    // --- Arithmetic ---
    /** later - earlier → TimeDelta (positive when later > earlier). */
    diff: (later: Timestamp, earlier: Timestamp) =>
        (later - earlier) as TimeDelta,
    /**
     * to - from → TimeDelta. Reads as "time elapsed from `from` to `to`".
     * Positive when `to` is after `from`. Identical math to diff(to, from);
     * choose whichever reads more naturally at the call site.
     */
    elapsed: (from: Timestamp, to: Timestamp) =>
        (to - from) as TimeDelta,
    /** Timestamp + TimeDelta → Timestamp */
    add: (t: Timestamp, d: TimeDelta) =>
        ((t as number) + (d as number)) as Timestamp,
    /** Timestamp - TimeDelta → Timestamp (may cross into negative territory) */
    sub: (t: Timestamp, d: TimeDelta) =>
        ((t as number) - (d as number)) as Timestamp,
    clamp: (t: Timestamp, min: Timestamp, max: Timestamp) =>
        (t < min ? min : t > max ? max : t) as Timestamp,
    min: (a: Timestamp, b: Timestamp) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as Timestamp,
    max: (a: Timestamp, b: Timestamp) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as Timestamp,
} as const;
// --------------------------------------------------------------------------
// DataSize — non-negative amount of data (bytes)
// --------------------------------------------------------------------------
// Payload / message / file sizes, buffer levels, queue depths.
// Invariant non-negative. For signed differences, use DataSize.diff
// or work in DataSizeDelta.
export const DataSize = {
    ZERO:     0 as DataSize,
    INF:      Infinity as DataSize,
    NOT_INIT: NaN as DataSize,
    // --- Factories ---
    fromBytes: (n: number) => n as DataSize,
    fromBits:  (n: number) => (n / BITS_PER_BYTE) as DataSize,
    // SI decimal (1000-based)
    fromKB: (n: number) => (n * SI_K) as DataSize,
    fromMB: (n: number) => (n * SI_M) as DataSize,
    fromGB: (n: number) => (n * SI_G) as DataSize,
    // IEC binary (1024-based)
    fromKiB: (n: number) => (n * KIB) as DataSize,
    fromMiB: (n: number) => (n * MIB) as DataSize,
    fromGiB: (n: number) => (n * GIB) as DataSize,
    /** DataSizeDelta → DataSize. Returns NOT_INIT if delta is negative. */
    fromDelta: (d: DataSizeDelta) =>
        ((d as number) < 0 ? NaN : (d as number)) as DataSize,
    // --- Accessors ---
    toBytes: (s: DataSize) => s as number,
    toBits:  (s: DataSize) => (s as number) * BITS_PER_BYTE,
    toKB: (s: DataSize) => (s as number) / SI_K,
    toMB: (s: DataSize) => (s as number) / SI_M,
    toGB: (s: DataSize) => (s as number) / SI_G,
    toKiB: (s: DataSize) => (s as number) / KIB,
    toMiB: (s: DataSize) => (s as number) / MIB,
    toGiB: (s: DataSize) => (s as number) / GIB,
    // --- Predicates ---
    isValid:  (s: DataSize) => !Number.isNaN(s),
    isFinite: (s: DataSize) => Number.isFinite(s),
    isZero:   (s: DataSize) => s === 0,
    // --- Comparison ---
    /** left > right */
    gt:  (left: DataSize, right: DataSize) => left > right,
    /** left >= right */
    gte: (left: DataSize, right: DataSize) => left >= right,
    /** left < right */
    lt:  (left: DataSize, right: DataSize) => left < right,
    /** left <= right */
    lte: (left: DataSize, right: DataSize) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: DataSize, b: DataSize) => a === b,
    // --- Arithmetic ---
    /** DataSize + DataSize → DataSize (sum of amounts). */
    add: (a: DataSize, b: DataSize) => (a + b) as DataSize,
    /**
     * minuend - subtrahend → DataSize.
     * Returns NOT_INIT if subtrahend > minuend (invariant violation).
     * Use diff() for signed semantics.
     */
    sub: (minuend: DataSize, subtrahend: DataSize) => {
        const r = (minuend as number) - (subtrahend as number);
        return (r < 0 ? NaN : r) as DataSize;
    },
    /** a - b → DataSizeDelta (signed). */
    diff: (a: DataSize, b: DataSize) =>
        ((a as number) - (b as number)) as DataSizeDelta,
    /**
     * DataSize × factor → DataSize.
     * Factor must be non-negative; returns NOT_INIT if factor < 0.
     */
    scale: (s: DataSize, factor: number) =>
        (factor < 0 ? NaN : (s as number) * factor) as DataSize,
    /** numerator / denominator → unitless ratio. */
    ratio: (numerator: DataSize, denominator: DataSize) =>
        (numerator as number) / (denominator as number),
    /**
     * DataSize / TimeDelta → DataRate.
     * Returns NOT_INIT if duration is negative or NaN (invariant
     * violation for the non-negative DataRate type). Use DataSizeDelta.per
     * if signed arithmetic is wanted.
     */
    per: (size: DataSize, duration: TimeDelta): DataRate => {
        const d = duration as number;
        // !(d >= 0) catches both negative AND NaN in one idiom; zero falls
        // through to IEEE 754 (Infinity for N/0, NaN for 0/0).
        if (!(d >= 0)) return NaN as DataRate;
        return (((size as number) * BITS_PER_BYTE * MS_PER_SEC) / d) as DataRate;
    },
    /** DataSize / DataRate → TimeDelta (transmission time). */
    at: (size: DataSize, rate: DataRate): TimeDelta =>
        (((size as number) * BITS_PER_BYTE * MS_PER_SEC) / (rate as number)) as TimeDelta,
    clamp: (s: DataSize, min: DataSize, max: DataSize) =>
        (s < min ? min : s > max ? max : s) as DataSize,
    min: (a: DataSize, b: DataSize) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as DataSize,
    max: (a: DataSize, b: DataSize) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as DataSize,
    /** Human-readable: "500 B" | "1.5 KB" | "2.3 MB" (SI by default). */
    format: (s: DataSize, opts: { binary?: boolean } = {}) =>
        fmtBytes(s as number, opts.binary ?? false),
} as const;
// --------------------------------------------------------------------------
// DataSizeDelta — signed byte difference
// --------------------------------------------------------------------------
// Signed counterpart to DataSize. Result type of DataSize.diff, and
// the working type when you need to do arithmetic that may cross zero
// (queue depth changes, running deltas, scaled adjustments).
export const DataSizeDelta = {
    ZERO:     0 as DataSizeDelta,
    INF:      Infinity as DataSizeDelta,
    NEG_INF:  -Infinity as DataSizeDelta,
    NOT_INIT: NaN as DataSizeDelta,
    // --- Factories ---
    fromBytes: (n: number) => n as DataSizeDelta,
    fromBits:  (n: number) => (n / BITS_PER_BYTE) as DataSizeDelta,
    fromKB:  (n: number) => (n * SI_K) as DataSizeDelta,
    fromMB:  (n: number) => (n * SI_M) as DataSizeDelta,
    fromGB:  (n: number) => (n * SI_G) as DataSizeDelta,
    fromKiB: (n: number) => (n * KIB) as DataSizeDelta,
    fromMiB: (n: number) => (n * MIB) as DataSizeDelta,
    fromGiB: (n: number) => (n * GIB) as DataSizeDelta,
    /**
     * DataSize → DataSizeDelta. Branded widening: every non-negative
     * DataSize is a valid DataSizeDelta (deltas allow any sign).
     */
    fromSize: (s: DataSize) => s as unknown as DataSizeDelta,
    // --- Accessors ---
    toBytes: (d: DataSizeDelta) => d as number,
    toBits:  (d: DataSizeDelta) => (d as number) * BITS_PER_BYTE,
    toKB:  (d: DataSizeDelta) => (d as number) / SI_K,
    toMB:  (d: DataSizeDelta) => (d as number) / SI_M,
    toGB:  (d: DataSizeDelta) => (d as number) / SI_G,
    toKiB: (d: DataSizeDelta) => (d as number) / KIB,
    toMiB: (d: DataSizeDelta) => (d as number) / MIB,
    toGiB: (d: DataSizeDelta) => (d as number) / GIB,
    // --- Predicates ---
    isValid:    (d: DataSizeDelta) => !Number.isNaN(d),
    isFinite:   (d: DataSizeDelta) => Number.isFinite(d),
    isZero:     (d: DataSizeDelta) => d === 0,
    isPositive: (d: DataSizeDelta) => d > 0,
    isNegative: (d: DataSizeDelta) => d < 0,
    // --- Comparison ---
    gt:  (left: DataSizeDelta, right: DataSizeDelta) => left > right,
    gte: (left: DataSizeDelta, right: DataSizeDelta) => left >= right,
    lt:  (left: DataSizeDelta, right: DataSizeDelta) => left < right,
    lte: (left: DataSizeDelta, right: DataSizeDelta) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: DataSizeDelta, b: DataSizeDelta) => a === b,
    // --- Arithmetic (full signed) ---
    add: (a: DataSizeDelta, b: DataSizeDelta) => (a + b) as DataSizeDelta,
    sub: (minuend: DataSizeDelta, subtrahend: DataSizeDelta) =>
        (minuend - subtrahend) as DataSizeDelta,
    scale:  (d: DataSizeDelta, factor: number) => (d * factor) as DataSizeDelta,
    abs:    (d: DataSizeDelta) => Math.abs(d) as DataSizeDelta,
    negate: (d: DataSizeDelta) => (-d) as DataSizeDelta,
    ratio: (numerator: DataSizeDelta, denominator: DataSizeDelta) =>
        (numerator as number) / (denominator as number),
    /**
     * DataSizeDelta / TimeDelta → DataRateDelta (fully signed).
     * No invariant guards: negative duration flips the sign of the
     * result, NaN in either operand propagates. Use DataSize.per for the
     * non-negative variant that rejects negative/NaN durations.
     */
    per: (delta: DataSizeDelta, duration: TimeDelta): DataRateDelta =>
        (((delta as number) * BITS_PER_BYTE * MS_PER_SEC) / (duration as number)) as DataRateDelta,
    clamp: (d: DataSizeDelta, min: DataSizeDelta, max: DataSizeDelta) =>
        (d < min ? min : d > max ? max : d) as DataSizeDelta,
    min: (a: DataSizeDelta, b: DataSizeDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as DataSizeDelta,
    max: (a: DataSizeDelta, b: DataSizeDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as DataSizeDelta,
    /** Human-readable with leading "-" for negatives: "1.5 KB" | "-2.3 MB". */
    format: (d: DataSizeDelta, opts: { binary?: boolean } = {}) =>
        fmtBytes(d as number, opts.binary ?? false),
} as const;
// --------------------------------------------------------------------------
// DataRate — non-negative throughput (bits/sec)
// --------------------------------------------------------------------------
// Throughput estimates, configured rate limits, target transfer rates.
// Invariant non-negative. Decimal prefixes only (Kbps/Mbps/Gbps are
// universally 1000-based in networking contexts).
export const DataRate = {
    ZERO:     0 as DataRate,
    INF:      Infinity as DataRate,
    NOT_INIT: NaN as DataRate,
    // --- Factories ---
    fromBps:  (n: number) => n as DataRate,
    fromKbps: (n: number) => (n * SI_K) as DataRate,
    fromMbps: (n: number) => (n * SI_M) as DataRate,
    fromGbps: (n: number) => (n * SI_G) as DataRate,
    fromBytesPerSec: (n: number) => (n * BITS_PER_BYTE) as DataRate,
    /** DataRateDelta → DataRate. Returns NOT_INIT if delta is negative. */
    fromDelta: (d: DataRateDelta) =>
        ((d as number) < 0 ? NaN : (d as number)) as DataRate,
    // --- Accessors ---
    toBps:  (r: DataRate) => r as number,
    toKbps: (r: DataRate) => (r as number) / SI_K,
    toMbps: (r: DataRate) => (r as number) / SI_M,
    toGbps: (r: DataRate) => (r as number) / SI_G,
    toBytesPerSec: (r: DataRate) => (r as number) / BITS_PER_BYTE,
    // --- Predicates ---
    isValid:  (r: DataRate) => !Number.isNaN(r),
    isFinite: (r: DataRate) => Number.isFinite(r),
    isZero:   (r: DataRate) => r === 0,
    // --- Comparison ---
    gt:  (left: DataRate, right: DataRate) => left > right,
    gte: (left: DataRate, right: DataRate) => left >= right,
    lt:  (left: DataRate, right: DataRate) => left < right,
    lte: (left: DataRate, right: DataRate) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: DataRate, b: DataRate) => a === b,
    // --- Arithmetic ---
    /** DataRate + DataRate → DataRate. */
    add: (a: DataRate, b: DataRate) => (a + b) as DataRate,
    /**
     * minuend - subtrahend → DataRate.
     * Returns NOT_INIT if subtrahend > minuend. Use diff() for signed.
     */
    sub: (minuend: DataRate, subtrahend: DataRate) => {
        const r = (minuend as number) - (subtrahend as number);
        return (r < 0 ? NaN : r) as DataRate;
    },
    /** a - b → DataRateDelta (signed). */
    diff: (a: DataRate, b: DataRate) =>
        ((a as number) - (b as number)) as DataRateDelta,
    /**
     * DataRate × factor → DataRate.
     * Factor must be non-negative; returns NOT_INIT if factor < 0.
     */
    scale: (r: DataRate, factor: number) =>
        (factor < 0 ? NaN : (r as number) * factor) as DataRate,
    ratio: (numerator: DataRate, denominator: DataRate) =>
        (numerator as number) / (denominator as number),
    /**
     * DataRate × TimeDelta → DataSize (bandwidth-delay product).
     * Returns NOT_INIT if duration is negative or NaN.
     */
    over: (rate: DataRate, duration: TimeDelta): DataSize => {
        const d = duration as number;
        // !(d >= 0) catches both negative AND NaN.
        if (!(d >= 0)) return NaN as DataSize;
        return (((rate as number) * d) / (BITS_PER_BYTE * MS_PER_SEC)) as DataSize;
    },
    clamp: (r: DataRate, min: DataRate, max: DataRate) =>
        (r < min ? min : r > max ? max : r) as DataRate,
    min: (a: DataRate, b: DataRate) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as DataRate,
    max: (a: DataRate, b: DataRate) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as DataRate,
    /** Human-readable: "500 bps" | "1.5 Kbps" | "2.3 Mbps" | "1.2 Gbps". */
    format: (r: DataRate) => fmtBps(r as number),
} as const;
// --------------------------------------------------------------------------
// DataRateDelta — signed bits/sec difference
// --------------------------------------------------------------------------
// Signed counterpart to DataRate. Result type of DataRate.diff, and
// the working type for rate-change arithmetic (acceleration,
// correction signals, smoothed derivatives).
export const DataRateDelta = {
    ZERO:     0 as DataRateDelta,
    INF:      Infinity as DataRateDelta,
    NEG_INF:  -Infinity as DataRateDelta,
    NOT_INIT: NaN as DataRateDelta,
    // --- Factories ---
    fromBps:  (n: number) => n as DataRateDelta,
    fromKbps: (n: number) => (n * SI_K) as DataRateDelta,
    fromMbps: (n: number) => (n * SI_M) as DataRateDelta,
    fromGbps: (n: number) => (n * SI_G) as DataRateDelta,
    fromBytesPerSec: (n: number) => (n * BITS_PER_BYTE) as DataRateDelta,
    /**
     * DataRate → DataRateDelta. Branded widening: every non-negative
     * DataRate is a valid DataRateDelta (deltas allow any sign).
     */
    fromRate: (r: DataRate) => r as unknown as DataRateDelta,
    // --- Accessors ---
    toBps:  (d: DataRateDelta) => d as number,
    toKbps: (d: DataRateDelta) => (d as number) / SI_K,
    toMbps: (d: DataRateDelta) => (d as number) / SI_M,
    toGbps: (d: DataRateDelta) => (d as number) / SI_G,
    toBytesPerSec: (d: DataRateDelta) => (d as number) / BITS_PER_BYTE,
    // --- Predicates ---
    isValid:    (d: DataRateDelta) => !Number.isNaN(d),
    isFinite:   (d: DataRateDelta) => Number.isFinite(d),
    isZero:     (d: DataRateDelta) => d === 0,
    isPositive: (d: DataRateDelta) => d > 0,
    isNegative: (d: DataRateDelta) => d < 0,
    // --- Comparison ---
    gt:  (left: DataRateDelta, right: DataRateDelta) => left > right,
    gte: (left: DataRateDelta, right: DataRateDelta) => left >= right,
    lt:  (left: DataRateDelta, right: DataRateDelta) => left < right,
    lte: (left: DataRateDelta, right: DataRateDelta) => left <= right,
    /** Note: per IEEE 754, eq(NOT_INIT, NOT_INIT) is false. */
    eq:  (a: DataRateDelta, b: DataRateDelta) => a === b,
    // --- Arithmetic (full signed) ---
    add: (a: DataRateDelta, b: DataRateDelta) => (a + b) as DataRateDelta,
    sub: (minuend: DataRateDelta, subtrahend: DataRateDelta) =>
        (minuend - subtrahend) as DataRateDelta,
    scale:  (d: DataRateDelta, factor: number) => (d * factor) as DataRateDelta,
    abs:    (d: DataRateDelta) => Math.abs(d) as DataRateDelta,
    negate: (d: DataRateDelta) => (-d) as DataRateDelta,
    ratio: (numerator: DataRateDelta, denominator: DataRateDelta) =>
        (numerator as number) / (denominator as number),
    /**
     * DataRateDelta × TimeDelta → DataSizeDelta (fully signed).
     * No invariant guards: negative duration flips the sign of the
     * result, NaN in either operand propagates. Use DataRate.over for
     * the non-negative variant that rejects negative/NaN durations.
     */
    over: (delta: DataRateDelta, duration: TimeDelta): DataSizeDelta =>
        (((delta as number) * (duration as number)) / (BITS_PER_BYTE * MS_PER_SEC)) as DataSizeDelta,
    clamp: (d: DataRateDelta, min: DataRateDelta, max: DataRateDelta) =>
        (d < min ? min : d > max ? max : d) as DataRateDelta,
    min: (a: DataRateDelta, b: DataRateDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a <= b ? a : b) as DataRateDelta,
    max: (a: DataRateDelta, b: DataRateDelta) =>
        (Number.isNaN(a) || Number.isNaN(b) ? NaN : a >= b ? a : b) as DataRateDelta,
    /** Human-readable with leading "-" for negatives: "1.5 Kbps" | "-2.3 Mbps". */
    format: (d: DataRateDelta) => fmtBps(d as number),
} as const;
// --------------------------------------------------------------------------
// Clock — abstraction over time source + scheduling
// --------------------------------------------------------------------------
// Decouples timing-sensitive code from the runtime environment.
// Implementations provide both current time and deferred callback
// scheduling so tests can drive both deterministically.
//
//   Production: PerfClock — performance.now() + setTimeout
//   Testing:    MockClock — manually advance time; due callbacks fire
//               in order during advance()
/** Returned by Clock.schedule; call to cancel the pending callback. */
export type Cancel = () => void;
export interface Clock {
    /** Current time. */
    now(): Timestamp;
    /**
     * Schedule a callback to fire after `delay`. Returns a Cancel
     * function.
     *
     * Negative, NaN, or non-finite delays are clamped to 0 ("fire as
     * soon as possible"). This matches setTimeout semantics and is
     * uniform across PerfClock (next event loop tick) and MockClock
     * (next advance() call). If you want fail-loud on bad delays, guard
     * at your call site before calling schedule.
     */
    schedule(delay: TimeDelta, cb: () => void): Cancel;
}
export class PerfClock implements Clock {
    now(): Timestamp {
        return performance.now() as Timestamp;
    }
    schedule(delay: TimeDelta, cb: () => void): Cancel {
        const raw = delay as number;
        // `raw >= 0` is false for both negative and NaN, clamping both to 0.
        const ms = raw >= 0 ? raw : 0;
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
    }
}
// MockClock lives in its own module — it's the test-support half of the
// Clock abstraction. Still exported from the package root for
// convenience.
export { MockClock } from "./mock-clock.js";