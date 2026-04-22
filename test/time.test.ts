import { test } from "node:test";
import assert from "node:assert/strict";
import { TimeDelta, Timestamp } from "../src/index.js";

test("TimeDelta factories and accessors round-trip", () => {
    assert.equal(TimeDelta.toMs(TimeDelta.fromMs(500)), 500);
    assert.equal(TimeDelta.toSec(TimeDelta.fromSec(2.5)), 2.5);
    assert.equal(TimeDelta.toMs(TimeDelta.fromSec(1)), 1000);
    assert.equal(TimeDelta.toSec(TimeDelta.fromMs(1500)), 1.5);
});

test("TimeDelta arithmetic", () => {
    const a = TimeDelta.fromMs(300);
    const b = TimeDelta.fromMs(100);
    assert.equal(TimeDelta.toMs(TimeDelta.add(a, b)), 400);
    assert.equal(TimeDelta.toMs(TimeDelta.sub(a, b)), 200);
    assert.equal(TimeDelta.toMs(TimeDelta.sub(b, a)), -200); // signed
    assert.equal(TimeDelta.toMs(TimeDelta.scale(a, 0.5)), 150);
    assert.equal(TimeDelta.toMs(TimeDelta.scale(a, -2)), -600);
    assert.equal(TimeDelta.toMs(TimeDelta.abs(TimeDelta.fromMs(-50))), 50);
    assert.equal(TimeDelta.toMs(TimeDelta.negate(a)), -300);
});

test("TimeDelta clamp respects bounds and ignores NaN", () => {
    const d = TimeDelta.fromMs(1500);
    const lo = TimeDelta.fromMs(0);
    const hi = TimeDelta.fromMs(1000);
    assert.equal(TimeDelta.toMs(TimeDelta.clamp(d, lo, hi)), 1000);
    assert.equal(TimeDelta.toMs(TimeDelta.clamp(TimeDelta.fromMs(-10), lo, hi)), 0);
    assert.equal(TimeDelta.toMs(TimeDelta.clamp(TimeDelta.fromMs(500), lo, hi)), 500);
});

test("TimeDelta predicates", () => {
    assert.equal(TimeDelta.isValid(TimeDelta.NOT_INIT), false);
    assert.equal(TimeDelta.isValid(TimeDelta.ZERO), true);
    assert.equal(TimeDelta.isFinite(TimeDelta.INF), false);
    assert.equal(TimeDelta.isFinite(TimeDelta.fromMs(0)), true);
    assert.equal(TimeDelta.isZero(TimeDelta.ZERO), true);
    assert.equal(TimeDelta.isZero(TimeDelta.fromMs(1)), false);
    assert.equal(TimeDelta.isPositive(TimeDelta.fromMs(1)), true);
    assert.equal(TimeDelta.isNegative(TimeDelta.fromMs(-1)), true);
    assert.equal(TimeDelta.isPositive(TimeDelta.ZERO), false);
});

test("TimeDelta.ratio divides operands", () => {
    assert.equal(TimeDelta.ratio(TimeDelta.fromMs(300), TimeDelta.fromMs(100)), 3);
    assert.equal(TimeDelta.ratio(TimeDelta.ZERO, TimeDelta.fromMs(100)), 0);
});

test("NOT_INIT poisons arithmetic and fails comparisons", () => {
    const d = TimeDelta.add(TimeDelta.NOT_INIT, TimeDelta.fromMs(100));
    assert.equal(TimeDelta.isValid(d), false);
    // NaN > anything is false, NaN < anything is false.
    assert.equal(TimeDelta.gt(TimeDelta.NOT_INIT, TimeDelta.ZERO), false);
    assert.equal(TimeDelta.lt(TimeDelta.NOT_INIT, TimeDelta.INF), false);
    // eq(NOT_INIT, NOT_INIT) is false by IEEE 754 — this is documented.
    assert.equal(TimeDelta.eq(TimeDelta.NOT_INIT, TimeDelta.NOT_INIT), false);
});

test("TimeDelta.min / max propagate NaN", () => {
    assert.equal(TimeDelta.isValid(TimeDelta.min(TimeDelta.NOT_INIT, TimeDelta.ZERO)), false);
    assert.equal(TimeDelta.isValid(TimeDelta.max(TimeDelta.NOT_INIT, TimeDelta.ZERO)), false);
    assert.equal(
        TimeDelta.toMs(TimeDelta.min(TimeDelta.fromMs(5), TimeDelta.fromMs(10))),
        5,
    );
});

test("Timestamp.diff and Timestamp.elapsed are identical math", () => {
    const start = Timestamp.fromMs(1000);
    const end = Timestamp.fromMs(1750);
    assert.equal(TimeDelta.toMs(Timestamp.diff(end, start)), 750);
    assert.equal(TimeDelta.toMs(Timestamp.elapsed(start, end)), 750);
    // Signed: earlier - later is negative.
    assert.equal(TimeDelta.toMs(Timestamp.diff(start, end)), -750);
});

test("Timestamp.add and sub move in TimeDelta steps", () => {
    const t = Timestamp.fromMs(500);
    const d = TimeDelta.fromMs(250);
    assert.equal(Timestamp.toMs(Timestamp.add(t, d)), 750);
    assert.equal(Timestamp.toMs(Timestamp.sub(t, d)), 250);
    // sub that crosses zero is allowed — documented behavior.
    assert.equal(Timestamp.toMs(Timestamp.sub(t, TimeDelta.fromMs(600))), -100);
});

test("Timestamp has no ZERO export", () => {
    // Documented: Timestamp has no ZERO because epoch is arbitrary.
    assert.equal("ZERO" in Timestamp, false);
});
