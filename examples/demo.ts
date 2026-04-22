// Demo — exercises TokenBucketSender with deterministic time.

import {
  DataSize, DataRate, TimeDelta, Timestamp,
  MockClock,
} from "../src/index";
import { TokenBucketSender, type Packet } from "./paced-sender";

// --------------------------------------------------------------------------
// Scenario 1: burst + steady-state pacing
// --------------------------------------------------------------------------
// 80 Kbps = 10 KB/s. 2 KB burst capacity. Ten 1 KB packets.
// Expected:
//   t=0     → pkt-1, pkt-2 fire from burst credit.
//   t=100ms → pkt-3 (one 1 KB token refilled per 100ms).
//   t=200ms → pkt-4. ... t=800ms → pkt-10.
// --------------------------------------------------------------------------

const clock = new MockClock(0);
const rate     = DataRate.fromKbps(80);
const capacity = DataSize.fromKB(2);

console.log(`Pacing at ${DataRate.format(rate)}, burst ${DataSize.format(capacity)}`);
console.log("─".repeat(52));

const log: Array<{ at: Timestamp; payload: string }> = [];
const sender = new TokenBucketSender<string>(
  clock,
  { rate, capacity },
  (p) => log.push({ at: clock.now(), payload: p.payload }),
);

for (let i = 1; i <= 10; i++) {
  sender.enqueue({ size: DataSize.fromKB(1), payload: `pkt-${i.toString().padStart(2, "0")}` });
}

console.log(
  `after enqueue: fired=${log.length}, queued=${sender.queueLength}, ` +
  `tokens=${DataSize.format(sender.tokensAvailable())}`,
);

clock.advance(TimeDelta.fromSec(1));

console.log("\ntimeline:");
for (const e of log) {
  const t = TimeDelta.format(Timestamp.toMs(e.at) as TimeDelta);
  console.log(`  ${t.padStart(8)}  ${e.payload}`);
}

// --------------------------------------------------------------------------
// Scenario 2: idle period then burst
// --------------------------------------------------------------------------
// Sit idle so the bucket refills, then dump a batch that exploits burst.
// --------------------------------------------------------------------------

console.log("\n─── idle refill + burst ".padEnd(52, "─"));

const clock2 = new MockClock(0);
const log2: Array<{ at: Timestamp; payload: string }> = [];
const sender2 = new TokenBucketSender<string>(
  clock2,
  { rate: DataRate.fromKbps(80), capacity: DataSize.fromKB(2), initialTokens: DataSize.ZERO },
  (p) => log2.push({ at: clock2.now(), payload: p.payload }),
);

console.log(`t=0ms   tokens=${DataSize.format(sender2.tokensAvailable())} (starting empty)`);

clock2.advance(TimeDelta.fromMs(500));
console.log(`t=500ms tokens=${DataSize.format(sender2.tokensAvailable())}  (refilled to cap)`);

// Three packets — two fire from burst, the third waits.
for (let i = 1; i <= 3; i++) {
  sender2.enqueue({ size: DataSize.fromKB(1), payload: `B${i}` });
}
console.log(`after burst enqueue: fired=${log2.length}, queued=${sender2.queueLength}`);

clock2.advance(TimeDelta.fromSec(1));
console.log("timeline:");
for (const e of log2) {
  const t = TimeDelta.format(Timestamp.toMs(e.at) as TimeDelta);
  console.log(`  ${t.padStart(8)}  ${e.payload}`);
}

// --------------------------------------------------------------------------
// Scenario 3: measured throughput sanity check
// --------------------------------------------------------------------------

console.log("\n─── throughput measurement ".padEnd(52, "─"));

const clock3 = new MockClock(0);
let bytesSent = DataSize.ZERO;
const sender3 = new TokenBucketSender<void>(
  clock3,
  { rate: DataRate.fromMbps(1), capacity: DataSize.fromKB(10) },
  (p) => { bytesSent = DataSize.add(bytesSent, p.size); },
);

// Keep a steady backlog of 4 KB packets.
for (let i = 0; i < 200; i++) {
  sender3.enqueue({ size: DataSize.fromKB(4), payload: undefined });
}

const window = TimeDelta.fromSec(5);
const start  = clock3.now();
clock3.advance(window);
const elapsed  = Timestamp.elapsed(start, clock3.now());
const measured = DataSize.per(bytesSent, elapsed);

console.log(`window:     ${TimeDelta.format(window)}`);
console.log(`sent:       ${DataSize.format(bytesSent)}`);
console.log(`measured:   ${DataRate.format(measured)}`);
console.log(`configured: ${DataRate.format(DataRate.fromMbps(1))}`);
console.log(`queued:     ${sender3.queueLength} packets still backlogged`);
