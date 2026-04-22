import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DataSize, DataRate, TimeDelta,
    DataSizeDelta, DataRateDelta,
} from "../src/index.js";

test("DataSize.per yields the correct DataRate", () => {
    // 1 MB in 1 second = 8 Mbps.
    const rate = DataSize.per(DataSize.fromMB(1), TimeDelta.fromSec(1));
    assert.equal(DataRate.toMbps(rate), 8);

    // 1 KB in 100 ms = 80 Kbps (1 KB = 8 Kb; over 0.1 s → 80 Kbps).
    const r2 = DataSize.per(DataSize.fromKB(1), TimeDelta.fromMs(100));
    assert.equal(DataRate.toKbps(r2), 80);
});

test("DataSize.at is the inverse of DataSize.per", () => {
    const size = DataSize.fromMB(4);
    const rate = DataRate.fromMbps(8);
    const dur = DataSize.at(size, rate);                    // TimeDelta
    assert.equal(TimeDelta.toSec(dur), 4);

    // Round-trip: size/dur should recover the rate.
    const rt = DataSize.per(size, dur);
    assert.equal(DataRate.toMbps(rt), 8);
});

test("DataRate.over is the bandwidth-delay product", () => {
    // 8 Mbps over 1 second = 1 MB.
    const s = DataRate.over(DataRate.fromMbps(8), TimeDelta.fromSec(1));
    assert.equal(DataSize.toMB(s), 1);

    // 80 Kbps over 100 ms = 1 KB.
    const s2 = DataRate.over(DataRate.fromKbps(80), TimeDelta.fromMs(100));
    assert.equal(DataSize.toKB(s2), 1);
});

test("DataSize.per returns NOT_INIT for negative or NaN durations", () => {
    const nan = DataSize.per(DataSize.fromKB(1), TimeDelta.NOT_INIT);
    assert.equal(DataRate.isValid(nan), false);

    const neg = DataSize.per(DataSize.fromKB(1), TimeDelta.fromMs(-10));
    assert.equal(DataRate.isValid(neg), false);
});

test("DataRate.over returns NOT_INIT for negative or NaN durations", () => {
    const nan = DataRate.over(DataRate.fromMbps(1), TimeDelta.NOT_INIT);
    assert.equal(DataSize.isValid(nan), false);

    const neg = DataRate.over(DataRate.fromMbps(1), TimeDelta.fromMs(-1));
    assert.equal(DataSize.isValid(neg), false);
});

test("DataSizeDelta.per is signed — negative duration flips sign", () => {
    const delta = DataSizeDelta.fromKB(1);
    const rd = DataSizeDelta.per(delta, TimeDelta.fromMs(-100));
    assert.equal(DataRateDelta.toKbps(rd), -80);
});

test("DataRateDelta.over is signed — negative rate over positive time", () => {
    const rd = DataRateDelta.fromKbps(-80);
    const ds = DataRateDelta.over(rd, TimeDelta.fromMs(100));
    assert.equal(DataSizeDelta.toKB(ds), -1);
});

test("NaN propagates through every cross-type operator", () => {
    const badSize = DataSize.NOT_INIT;
    const badTime = TimeDelta.NOT_INIT;
    const badRate = DataRate.NOT_INIT;

    assert.equal(DataRate.isValid(DataSize.per(badSize, TimeDelta.fromMs(100))), false);
    assert.equal(TimeDelta.isValid(DataSize.at(DataSize.fromMB(1), badRate)), false);
    assert.equal(DataSize.isValid(DataRate.over(badRate, TimeDelta.fromMs(100))), false);
    assert.equal(DataRate.isValid(DataSize.per(DataSize.fromMB(1), badTime)), false);
});
