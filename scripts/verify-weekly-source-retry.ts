import assert from "node:assert/strict";
import { retryWeeklySourceRead } from "../lib/wms/weekly-work-source";
async function main() {
  let calls = 0;
  const delays: number[] = [];
  const pause = async (ms: number) => { delays.push(ms); };
  assert.equal(await retryWeeklySourceRead(async () => {
    if (++calls < 3) throw new Error("[입고요약] The service is currently unavailable.");
    return "confirmed";
  }, pause), "confirmed");
  assert.equal(calls, 3); assert.deepEqual(delays, [300, 600]);
  calls = 0;
  await assert.rejects(retryWeeklySourceRead(async () => { calls++; throw new Error("The service is currently unavailable."); }, async () => {}));
  assert.equal(calls, 3, "Repeated outage remains a source failure, never a guessed result");
  for (const reason of ["Forbidden", "발주서 수량 불일치", "Drive 연결이 필요합니다."]) {
    calls = 0;
    await assert.rejects(retryWeeklySourceRead(async () => { calls++; throw new Error(reason); }, async () => { assert.fail("permanent error must not retry"); }), new RegExp(reason));
    assert.equal(calls, 1);
  }
  console.log("Weekly source retry PASS: temporary read recovery, bounded outage and permanent-data failure; fixtures only");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
