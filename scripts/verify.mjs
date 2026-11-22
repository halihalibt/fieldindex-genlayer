import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { client, inspectReceipt, read } from "../src/chain.js";
import { brier, PROTOCOL } from "../src/model.js";

const manifest = JSON.parse(readFileSync(new URL("../public/deployment.json", import.meta.url)));
const journal = JSON.parse(readFileSync(new URL("../evidence/studionet.json", import.meta.url)));
const source = readFileSync(new URL("../contracts/field_index.py", import.meta.url), "utf8");
assert.equal(manifest.address, journal.address);
assert.equal(manifest.demoRound, journal.round);
assert.equal(manifest.deployTx, journal.steps[0].hash);
assert.equal(manifest.settleTx, journal.steps.at(-1).hash);
assert.equal(createHash("sha256").update(source).digest("hex"), journal.source_sha256);
assert.equal(await client.request({ method: "eth_chainId" }), "0xf22f");

const [deployed, protocol, round, directory, ...returned] = await Promise.all([
  client.getContractCode(manifest.address),
  client.readContract({ address: manifest.address, functionName: "protocol", args: [], transactionHashVariant: "latest-final" }),
  read(manifest.address, "get_round", [manifest.demoRound]),
  read(manifest.address, "recent_rounds"),
  ...journal.steps.map(async (step) => inspectReceipt(await client.getTransaction({ hash: step.hash }))),
]);
assert.equal(deployed, source);
assert.equal(protocol, PROTOCOL);
assert.deepEqual(round, journal.finalized_readback);
assert.ok(directory.includes(manifest.demoRound));
for (const [i, receipt] of returned.entries()) {
  assert.equal(receipt.status, "FINALIZED");
  assert.equal(receipt.consensus, "MAJORITY_AGREE");
  assert.equal(receipt.execution, journal.steps[i].expectedExecution);
  console.log(journal.steps[i].method, journal.steps[i].hash, receipt.status, receipt.execution);
}
for (const score of round.ranking) {
  const losses = round.entries[score.actor].probabilities.map((p, i) => (p - 100 * Number(round.bins[i] >= 5000)) ** 2);
  assert.deepEqual(score.losses, losses);
  assert.equal(score.loss_sum, losses.reduce((sum, loss) => sum + loss, 0));
}
console.log(JSON.stringify({
  address: manifest.address,
  round: manifest.demoRound,
  bins: round.bins,
  ranking: round.ranking.map((row) => ({ actor: row.actor, rank: row.rank, brier: brier(row.loss_sum) })),
  source_verified: true,
  readback: "MATCH",
}, null, 2));
