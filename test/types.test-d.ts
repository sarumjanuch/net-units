// Type-level tests. Not executed by node:test — the test runner glob is
// `*.test.js`, which does not match `types.test-d.js`. These live or die
// at `tsc` time: every `@ts-expect-error` below must match a real type
// error on the next non-comment line, or the build fails.
//
// Run via: `npm run typecheck` (or implicitly via `npm run build:test`).

import {
    TimeDelta, Timestamp,
    DataSize, DataSizeDelta,
    DataRate, DataRateDelta,
} from "../src/index.js";

// --------------------------------------------------------------------------
// Positive cases — these must type-check cleanly.
// --------------------------------------------------------------------------

const _td: TimeDelta = TimeDelta.fromMs(500);
const _ts: Timestamp = Timestamp.fromMs(1000);
const _ds: DataSize = DataSize.fromMB(1);
const _dr: DataRate = DataRate.fromMbps(10);

// Cross-type arrows infer the right result type without annotation.
const _rate: DataRate = DataSize.per(DataSize.fromMB(1), TimeDelta.fromSec(1));
const _dur:  TimeDelta = DataSize.at(DataSize.fromMB(1), DataRate.fromMbps(8));
const _size: DataSize = DataRate.over(DataRate.fromMbps(8), TimeDelta.fromSec(1));
const _dsd:  DataSizeDelta = DataSize.diff(DataSize.fromKB(5), DataSize.fromKB(2));
const _drd:  DataRateDelta = DataRate.diff(DataRate.fromMbps(5), DataRate.fromMbps(2));

// Safe widenings are allowed.
const _toDelta: DataSizeDelta = DataSizeDelta.fromSize(DataSize.fromKB(1));
const _toRD:    DataRateDelta = DataRateDelta.fromRate(DataRate.fromMbps(1));

// Narrowing back goes through an explicit conversion (runtime may yield NOT_INIT).
const _back: DataSize = DataSize.fromDelta(DataSizeDelta.fromKB(1));

// --------------------------------------------------------------------------
// Negative cases — every `@ts-expect-error` must flag a real error.
// --------------------------------------------------------------------------

// Raw numbers cannot be assigned to branded types.
// @ts-expect-error — number is not TimeDelta
const _n1: TimeDelta = 500;
// @ts-expect-error — number is not DataSize
const _n2: DataSize = 1024;
// @ts-expect-error — number is not DataRate
const _n3: DataRate = 1_000_000;

// Raw arithmetic strips the brand.
// @ts-expect-error — `number / number` is not DataRate
const _n4: DataRate = DataSize.fromMB(1) / TimeDelta.fromMs(100);
// @ts-expect-error — `number - number` is not TimeDelta
const _n5: TimeDelta = Timestamp.fromMs(2000) - Timestamp.fromMs(1000);

// Argument order must be right: per(size, duration), not per(duration, size).
// @ts-expect-error — TimeDelta is not DataSize
DataSize.per(TimeDelta.fromMs(500), DataSize.fromMB(1));

// Different branded types do not interconvert implicitly.
// @ts-expect-error — DataSize is not DataRate
const _n6: DataRate = DataSize.fromMB(1);
// @ts-expect-error — TimeDelta is not Timestamp
const _n7: Timestamp = TimeDelta.fromMs(100);
// @ts-expect-error — Timestamp is not TimeDelta
const _n8: TimeDelta = Timestamp.fromMs(100);
// @ts-expect-error — DataSizeDelta is not DataSize (must go through fromDelta)
const _n9: DataSize = DataSizeDelta.fromKB(5);
// @ts-expect-error — DataRateDelta is not DataRate (must go through fromDelta)
const _n10: DataRate = DataRateDelta.fromMbps(5);

// Cross-type operators reject wrong operand types.
// @ts-expect-error — TimeDelta cannot be added to DataSize
TimeDelta.add(TimeDelta.fromMs(1), DataSize.fromMB(1));
// @ts-expect-error — DataSize cannot be added to DataRate
DataRate.add(DataRate.fromMbps(1), DataSize.fromMB(1));
// @ts-expect-error — Timestamp - Timestamp goes through Timestamp.diff, not sub
Timestamp.sub(Timestamp.fromMs(10), Timestamp.fromMs(5));

// Comparisons across different brands are rejected.
// @ts-expect-error — cannot compare TimeDelta with DataSize
TimeDelta.gt(TimeDelta.fromMs(1), DataSize.fromMB(1));
// @ts-expect-error — cannot compare DataRate with DataRateDelta
DataRate.eq(DataRate.fromMbps(1), DataRateDelta.fromMbps(1));

// Non-negative types do not expose signed-only operations.
// @ts-expect-error — DataSize has no `negate`
DataSize.negate(DataSize.fromKB(1));
// @ts-expect-error — DataRate has no `abs`
DataRate.abs(DataRate.fromMbps(1));
// @ts-expect-error — Timestamp has no `format`
Timestamp.format(Timestamp.fromMs(0));
// @ts-expect-error — Timestamp has no ZERO
const _n11 = Timestamp.ZERO;
