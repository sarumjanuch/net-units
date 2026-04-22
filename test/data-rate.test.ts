import { test } from "node:test";
import assert from "node:assert/strict";
import { DataRate, DataRateDelta } from "../src/index.js";

test("DataRate factories use decimal prefixes", () => {
    assert.equal(DataRate.toBps(DataRate.fromKbps(1)), 1000);
    assert.equal(DataRate.toBps(DataRate.fromMbps(1)), 1_000_000);
    assert.equal(DataRate.toBps(DataRate.fromGbps(1)), 1_000_000_000);
});

test("DataRate.fromBytesPerSec converts via ×8", () => {
    assert.equal(DataRate.toBps(DataRate.fromBytesPerSec(125)), 1000);
});

test("DataRate accessors round-trip", () => {
    const r = DataRate.fromMbps(8);
    assert.equal(DataRate.toMbps(r), 8);
    assert.equal(DataRate.toKbps(r), 8000);
    assert.equal(DataRate.toBps(r), 8_000_000);
    assert.equal(DataRate.toBytesPerSec(r), 1_000_000);
});

test("DataRate.add / sub behave like DataSize", () => {
    const a = DataRate.fromMbps(10);
    const b = DataRate.fromMbps(3);
    assert.equal(DataRate.toMbps(DataRate.add(a, b)), 13);
    assert.equal(DataRate.toMbps(DataRate.sub(a, b)), 7);
    assert.equal(DataRate.isValid(DataRate.sub(b, a)), false);
});

test("DataRate.diff returns signed DataRateDelta", () => {
    const down = DataRate.diff(DataRate.fromMbps(3), DataRate.fromMbps(10));
    assert.equal(DataRateDelta.toMbps(down), -7);
    assert.equal(DataRateDelta.isNegative(down), true);
});

test("DataRate.scale rejects negative factors", () => {
    assert.equal(
        DataRate.toMbps(DataRate.scale(DataRate.fromMbps(4), 0.25)),
        1,
    );
    assert.equal(
        DataRate.isValid(DataRate.scale(DataRate.fromMbps(4), -1)),
        false,
    );
});

test("DataRate.fromDelta widens only non-negative deltas", () => {
    const ok = DataRate.fromDelta(DataRateDelta.fromMbps(5));
    assert.equal(DataRate.toMbps(ok), 5);

    const bad = DataRate.fromDelta(DataRateDelta.fromMbps(-1));
    assert.equal(DataRate.isValid(bad), false);
});

test("DataRateDelta.fromRate is always safe", () => {
    const d = DataRateDelta.fromRate(DataRate.fromMbps(7));
    assert.equal(DataRateDelta.toMbps(d), 7);
});

test("DataRate.clamp pins to bounds", () => {
    const lo = DataRate.fromMbps(1);
    const hi = DataRate.fromMbps(10);
    assert.equal(DataRate.toMbps(DataRate.clamp(DataRate.fromMbps(0), lo, hi)), 1);
    assert.equal(DataRate.toMbps(DataRate.clamp(DataRate.fromMbps(100), lo, hi)), 10);
});

test("DataRateDelta full signed arithmetic", () => {
    const a = DataRateDelta.fromMbps(4);
    const b = DataRateDelta.fromMbps(-1);
    assert.equal(DataRateDelta.toMbps(DataRateDelta.add(a, b)), 3);
    assert.equal(DataRateDelta.toMbps(DataRateDelta.scale(a, -2)), -8);
    assert.equal(DataRateDelta.toMbps(DataRateDelta.abs(b)), 1);
});
