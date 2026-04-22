import { test } from "node:test";
import assert from "node:assert/strict";
import {
    TimeDelta, Timestamp,
    DataSize, DataSizeDelta,
    DataRate, DataRateDelta,
} from "../src/index.js";

test("TimeDelta.format auto-scales to the right unit", () => {
    assert.equal(TimeDelta.format(TimeDelta.fromMs(0.5)), "0.50ms");
    assert.equal(TimeDelta.format(TimeDelta.fromMs(5)), "5.00ms");
    assert.equal(TimeDelta.format(TimeDelta.fromMs(500)), "500ms");
    assert.equal(TimeDelta.format(TimeDelta.fromMs(1500)), "1.50s");
    assert.equal(TimeDelta.format(TimeDelta.fromSec(90)), "1m 30s");
    assert.equal(TimeDelta.format(TimeDelta.fromSec(3600)), "1h");
    assert.equal(TimeDelta.format(TimeDelta.fromSec(3660)), "1h 1m");
});

test("TimeDelta.format renders signed values with a leading minus", () => {
    assert.equal(TimeDelta.format(TimeDelta.fromMs(-250)), "-250ms");
    assert.equal(TimeDelta.format(TimeDelta.fromSec(-5)), "-5.00s");
});

test("TimeDelta.format surfaces sentinels", () => {
    assert.equal(TimeDelta.format(TimeDelta.NOT_INIT), "NaN");
    assert.equal(TimeDelta.format(TimeDelta.INF), "+Infinity");
    assert.equal(TimeDelta.format(TimeDelta.NEG_INF), "-Infinity");
});

test("DataSize.format uses SI decimal by default", () => {
    assert.equal(DataSize.format(DataSize.fromBytes(500)), "500 B");
    assert.equal(DataSize.format(DataSize.fromKB(1.5)), "1.50 KB");
    assert.equal(DataSize.format(DataSize.fromMB(4.2)), "4.20 MB");
    assert.equal(DataSize.format(DataSize.fromGB(2)), "2.00 GB");
});

test("DataSize.format uses IEC binary when binary: true", () => {
    assert.equal(
        DataSize.format(DataSize.fromKiB(1.5), { binary: true }),
        "1.50 KiB",
    );
    assert.equal(
        DataSize.format(DataSize.fromMiB(2), { binary: true }),
        "2.00 MiB",
    );
});

test("DataSizeDelta.format shows sign for negatives", () => {
    assert.equal(DataSizeDelta.format(DataSizeDelta.fromKB(-1.5)), "-1.50 KB");
});

test("DataRate.format auto-scales to the right unit", () => {
    assert.equal(DataRate.format(DataRate.fromBps(500)), "500 bps");
    assert.equal(DataRate.format(DataRate.fromKbps(1.5)), "1.50 Kbps");
    assert.equal(DataRate.format(DataRate.fromMbps(53.3)), "53.3 Mbps");
    assert.equal(DataRate.format(DataRate.fromGbps(1.2)), "1.20 Gbps");
});

test("DataRateDelta.format shows sign for negatives", () => {
    assert.equal(DataRateDelta.format(DataRateDelta.fromMbps(-2.3)), "-2.30 Mbps");
});

test("Timestamp does not expose format (reads as TimeDelta when needed)", () => {
    // Documented: Timestamps are rendered via TimeDelta.format on ms offsets.
    assert.equal("format" in Timestamp, false);
});
