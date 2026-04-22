import { test } from "node:test";
import assert from "node:assert/strict";
import { MockClock, TimeDelta, Timestamp } from "../src/index.js";

test("MockClock starts at the given time and stays there until advanced", () => {
    const clock = new MockClock(1000);
    assert.equal(Timestamp.toMs(clock.now()), 1000);
    assert.equal(Timestamp.toMs(clock.now()), 1000);
});

test("advance moves the clock forward and fires due callbacks in order", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.fromMs(100), () => fired.push("a"));
    clock.schedule(TimeDelta.fromMs(50), () => fired.push("b"));
    clock.schedule(TimeDelta.fromMs(200), () => fired.push("c"));

    clock.advance(TimeDelta.fromMs(120));
    assert.deepEqual(fired, ["b", "a"]);
    assert.equal(Timestamp.toMs(clock.now()), 120);

    clock.advance(TimeDelta.fromMs(100));
    assert.deepEqual(fired, ["b", "a", "c"]);
    assert.equal(Timestamp.toMs(clock.now()), 220);
});

test("now() inside a callback returns the scheduled time, not the target", () => {
    const clock = new MockClock(0);
    const seen: number[] = [];
    clock.schedule(TimeDelta.fromMs(30), () => seen.push(Timestamp.toMs(clock.now())));
    clock.schedule(TimeDelta.fromMs(70), () => seen.push(Timestamp.toMs(clock.now())));

    clock.advance(TimeDelta.fromMs(200));
    assert.deepEqual(seen, [30, 70]);
    // Final position is the advance target, not the last callback's time.
    assert.equal(Timestamp.toMs(clock.now()), 200);
});

test("stable FIFO for callbacks scheduled at equal times", () => {
    const clock = new MockClock(0);
    const fired: number[] = [];
    for (let i = 0; i < 5; i++) {
        clock.schedule(TimeDelta.fromMs(50), () => fired.push(i));
    }
    clock.advance(TimeDelta.fromMs(50));
    assert.deepEqual(fired, [0, 1, 2, 3, 4]);
});

test("cancel prevents a scheduled callback from firing", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.fromMs(10), () => fired.push("a"));
    const cancel = clock.schedule(TimeDelta.fromMs(20), () => fired.push("b"));
    clock.schedule(TimeDelta.fromMs(30), () => fired.push("c"));

    cancel();
    clock.advance(TimeDelta.fromMs(100));
    assert.deepEqual(fired, ["a", "c"]);
});

test("cancel is idempotent and safe after firing", () => {
    const clock = new MockClock(0);
    let count = 0;
    const cancel = clock.schedule(TimeDelta.fromMs(10), () => count++);

    clock.advance(TimeDelta.fromMs(20));
    assert.equal(count, 1);

    // Calling cancel() after the callback fired should be a no-op.
    cancel();
    cancel();
    assert.equal(clock.pendingCount, 0);
});

test("re-entrant schedule during advance fires if due within the same advance", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.fromMs(10), () => {
        fired.push("outer");
        // scheduled at now()=10, delay 20 → fires at 30, within advance target of 100
        clock.schedule(TimeDelta.fromMs(20), () => fired.push("inner"));
    });

    clock.advance(TimeDelta.fromMs(100));
    assert.deepEqual(fired, ["outer", "inner"]);
});

test("advance(ZERO) drains zero-delay callbacks scheduled synchronously", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.ZERO, () => fired.push("a"));
    clock.schedule(TimeDelta.ZERO, () => fired.push("b"));

    clock.advance(TimeDelta.ZERO);
    assert.deepEqual(fired, ["a", "b"]);
});

test("negative, NaN, non-finite delays are clamped to 0 by schedule", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.fromMs(-100), () => fired.push("neg"));
    clock.schedule(TimeDelta.NOT_INIT, () => fired.push("nan"));
    clock.schedule(TimeDelta.INF, () => fired.push("inf")); // never fires

    clock.advance(TimeDelta.ZERO);
    assert.deepEqual(fired, ["neg", "nan"]);
    assert.equal(clock.pendingCount, 1); // the INF-delay callback is still pending
});

test("advance rejects negative, NaN, and non-finite delays with RangeError", () => {
    const clock = new MockClock(0);
    assert.throws(() => clock.advance(TimeDelta.fromMs(-1)), RangeError);
    assert.throws(() => clock.advance(TimeDelta.NOT_INIT), RangeError);
    assert.throws(() => clock.advance(TimeDelta.INF), RangeError);
});

test("set() moves time without firing callbacks", () => {
    const clock = new MockClock(0);
    const fired: string[] = [];
    clock.schedule(TimeDelta.fromMs(100), () => fired.push("x"));

    clock.set(Timestamp.fromMs(500));
    assert.equal(Timestamp.toMs(clock.now()), 500);
    assert.deepEqual(fired, []);
    assert.equal(clock.pendingCount, 1);
});

test("pendingCount tracks live callbacks", () => {
    const clock = new MockClock(0);
    assert.equal(clock.pendingCount, 0);

    const cancel1 = clock.schedule(TimeDelta.fromMs(10), () => {});
    clock.schedule(TimeDelta.fromMs(20), () => {});
    assert.equal(clock.pendingCount, 2);

    cancel1();
    assert.equal(clock.pendingCount, 1);

    clock.advance(TimeDelta.fromMs(100));
    assert.equal(clock.pendingCount, 0);
});
