import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSize, DataSizeDelta } from "../src/index.js";

test("DataSize SI factories use powers of 1000", () => {
    assert.equal(DataSize.toBytes(DataSize.fromKB(1)), 1000);
    assert.equal(DataSize.toBytes(DataSize.fromMB(1)), 1_000_000);
    assert.equal(DataSize.toBytes(DataSize.fromGB(1)), 1_000_000_000);
});

test("DataSize IEC factories use powers of 1024", () => {
    assert.equal(DataSize.toBytes(DataSize.fromKiB(1)), 1024);
    assert.equal(DataSize.toBytes(DataSize.fromMiB(1)), 1024 * 1024);
    assert.equal(DataSize.toBytes(DataSize.fromGiB(1)), 1024 * 1024 * 1024);
});

test("DataSize bit factories halve-round correctly", () => {
    assert.equal(DataSize.toBits(DataSize.fromBytes(1)), 8);
    assert.equal(DataSize.toBytes(DataSize.fromBits(16)), 2);
});

test("DataSize.add sums two non-negative sizes", () => {
    const sum = DataSize.add(DataSize.fromKB(2), DataSize.fromKB(3));
    assert.equal(DataSize.toKB(sum), 5);
});

test("DataSize.sub returns NOT_INIT on underflow", () => {
    const ok = DataSize.sub(DataSize.fromKB(5), DataSize.fromKB(2));
    assert.equal(DataSize.toKB(ok), 3);

    const underflow = DataSize.sub(DataSize.fromKB(2), DataSize.fromKB(5));
    assert.equal(DataSize.isValid(underflow), false);
});

test("DataSize.diff always returns signed DataSizeDelta", () => {
    const pos = DataSize.diff(DataSize.fromKB(5), DataSize.fromKB(2));
    assert.equal(DataSizeDelta.toKB(pos), 3);

    const neg = DataSize.diff(DataSize.fromKB(2), DataSize.fromKB(5));
    assert.equal(DataSizeDelta.toKB(neg), -3);
    assert.equal(DataSizeDelta.isNegative(neg), true);
});

test("DataSize.scale rejects negative factors, accepts non-negative", () => {
    assert.equal(
        DataSize.toKB(DataSize.scale(DataSize.fromKB(4), 0.5)),
        2,
    );
    assert.equal(DataSize.isValid(DataSize.scale(DataSize.fromKB(4), -1)), false);
});

test("DataSize.fromDelta widens only non-negative deltas", () => {
    const ok = DataSize.fromDelta(DataSizeDelta.fromKB(5));
    assert.equal(DataSize.toKB(ok), 5);

    const bad = DataSize.fromDelta(DataSizeDelta.fromKB(-1));
    assert.equal(DataSize.isValid(bad), false);
});

test("DataSizeDelta.fromSize is always safe", () => {
    const d = DataSizeDelta.fromSize(DataSize.fromKB(3));
    assert.equal(DataSizeDelta.toKB(d), 3);
});

test("DataSize.clamp pins to bounds", () => {
    const lo = DataSize.fromKB(1);
    const hi = DataSize.fromKB(10);
    assert.equal(DataSize.toKB(DataSize.clamp(DataSize.fromKB(0), lo, hi)), 1);
    assert.equal(DataSize.toKB(DataSize.clamp(DataSize.fromKB(20), lo, hi)), 10);
    assert.equal(DataSize.toKB(DataSize.clamp(DataSize.fromKB(5), lo, hi)), 5);
});

test("DataSize.min / max propagate NaN", () => {
    assert.equal(
        DataSize.isValid(DataSize.min(DataSize.NOT_INIT, DataSize.ZERO)),
        false,
    );
    assert.equal(
        DataSize.isValid(DataSize.max(DataSize.NOT_INIT, DataSize.ZERO)),
        false,
    );
    assert.equal(
        DataSize.toKB(DataSize.min(DataSize.fromKB(1), DataSize.fromKB(2))),
        1,
    );
});

test("DataSize.ratio divides two sizes", () => {
    assert.equal(
        DataSize.ratio(DataSize.fromKB(6), DataSize.fromKB(2)),
        3,
    );
});

test("DataSizeDelta supports the full signed arithmetic surface", () => {
    const a = DataSizeDelta.fromKB(5);
    const b = DataSizeDelta.fromKB(-2);
    assert.equal(DataSizeDelta.toKB(DataSizeDelta.add(a, b)), 3);
    assert.equal(DataSizeDelta.toKB(DataSizeDelta.sub(a, b)), 7);
    assert.equal(DataSizeDelta.toKB(DataSizeDelta.scale(a, -1.5)), -7.5);
    assert.equal(DataSizeDelta.toKB(DataSizeDelta.abs(b)), 2);
    assert.equal(DataSizeDelta.toKB(DataSizeDelta.negate(a)), -5);
});
