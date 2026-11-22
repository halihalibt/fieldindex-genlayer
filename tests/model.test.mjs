import test from "node:test";
import assert from "node:assert/strict";
import { commitment, freshSalt, phaseOf, brier } from "../src/model.js";
import { inspectReceipt } from "../src/chain.js";

test("cross-language commitment and domain isolation", async () => {
  const host = "0x" + "11".repeat(20);
  const actor = "0x" + "22".repeat(20);
  const addr = "0x" + "33".repeat(20);
  const salt = "ab".repeat(32);
  const vec = [10,20,30,40,50,60,70,80];
  const digest = await commitment(addr, host + "/replay", actor, vec, salt);
  assert.equal(digest, "cdc9d196efc587147aeccadc6f35eea4483d2a09f2f971dea2c9c0ea31252db8");
  assert.notEqual(await commitment(addr, host + "/replay2", actor, vec, salt), digest);
  assert.notEqual(await commitment(addr, host + "/replay", host, vec, salt), digest);
  assert.match(freshSalt(), /^[a-f0-9]{64}$/);
});

test("live cutoffs and loss formatting", () => {
  const row = { mode: "LIVE", day: "2026-11-23", reveal_until: "2026-11-25" };
  assert.equal(phaseOf(row, "2026-11-22"), "COMMIT");
  assert.equal(phaseOf(row, "2026-11-23"), "REVEAL");
  assert.equal(phaseOf(row, "2026-11-25"), "AWAITING_DATA");
  assert.equal(brier(20000), "0.2500");
});

test("finality, majority and execution are independent", () => {
  const tx = { statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: {
    leader_receipt: [{ mode: "leader", execution_result: "ERROR" }, { mode: "validator", execution_result: "SUCCESS" }]
  }};
  assert.equal(inspectReceipt(tx).success, false);
  tx.consensus_data.leader_receipt[0].execution_result = "SUCCESS";
  assert.equal(inspectReceipt(tx).success, true);
  tx.result_name = "MAJORITY_DISAGREE";
  assert.equal(inspectReceipt(tx).success, false);
});

test("browser audit detects tampering with scores and bins", async () => {
  const { auditSettlement } = await import("../src/model.js");
  const bins = [6333, 7000, 3667, 4333, 2000, 3000, 4000, 6333];
  const actor = "0x" + "11".repeat(20);
  const row = {
    bins, entries: { [actor]: { probabilities: [10, 20, 30, 40, 50, 60, 70, 80] } },
    ranking: [{ actor, rank: 1, loss_sum: 29400, losses: [8100, 6400, 900, 1600, 2500, 3600, 4900, 400] }],
  };
  row.ranking[0].loss_sum = row.ranking[0].losses.reduce((sum, loss) => sum + loss, 0);
  assert.deepEqual(auditSettlement(row), { match: true, events: [1, 1, 0, 0, 0, 0, 0, 1], checked: 1, reason: null });
  row.ranking[0].losses[3] += 1;
  assert.equal(auditSettlement(row).match, false);
  row.bins[0] = 6332;
  assert.equal(auditSettlement(row).reason, "Invalid eight-bin observation.");
});
