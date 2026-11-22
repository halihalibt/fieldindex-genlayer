import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { abi } from "genlayer-js";
import { client, inspectReceipt, read } from "../src/chain.js";
import { auditSettlement, brier, commitment, PROTOCOL } from "../src/model.js";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const manifest = json("../public/deployment.json");
const journal = json("../evidence/studionet.json");
const browser = json("../evidence/browser-replay.json");
const source = readFileSync(new URL("../contracts/field_index.py", import.meta.url), "utf8");
assert.equal(manifest.address, journal.address);
assert.equal(manifest.demoRound, journal.round);
assert.equal(manifest.deployTx, journal.steps[0].hash);
assert.equal(manifest.settleTx, journal.steps.at(-1).hash);
assert.equal(createHash("sha256").update(source).digest("hex"), journal.source_sha256);
assert.equal(await client.request({ method: "eth_chainId" }), "0xf22f");

const [deployed, protocol] = await Promise.all([
  client.getContractCode(manifest.address),
  client.readContract({ address: manifest.address, functionName: "protocol", args: [], transactionHashVariant: "latest-final" }),
]);
assert.equal(deployed, source);
assert.equal(protocol, PROTOCOL);

async function verifyRound(run) {
  const [round, ...transactions] = await Promise.all([
    read(manifest.address, "get_round", [run.round]),
    ...run.steps.map((step) => client.getTransaction({ hash: step.hash })),
  ]);
  assert.deepEqual(round, run.finalized_readback);
  assert.equal(auditSettlement(round).match, true);
  let reveals = 0;
  for (const [index, tx] of transactions.entries()) {
    const step = run.steps[index];
    const receipt = inspectReceipt(tx);
    assert.equal(receipt.status, "FINALIZED");
    assert.equal(receipt.consensus, "MAJORITY_AGREE");
    assert.equal(receipt.execution, step.expectedExecution ?? "SUCCESS");
    if (step.method !== "deploy") {
      assert.equal(tx.to_address?.toLowerCase(), manifest.address.toLowerCase());
      if (tx.value != null) assert.equal(BigInt(tx.value), 0n);
    }
    if (step.method === "reveal") {
      const leader = tx.consensus_data.leader_receipt.findLast(row => row.mode === "leader");
      const decoded = abi.calldata.decode(Buffer.from(leader.calldata.base64, "base64"));
      const [key, probabilities, salt] = decoded.get("args");
      const actor = tx.from_address.toLowerCase();
      const values = probabilities.map(Number);
      assert.equal(decoded.get("method"), "reveal");
      assert.equal(key, round.key);
      assert.deepEqual(round.entries[actor].probabilities, values);
      assert.equal(await commitment(manifest.address, key, actor, values, salt), round.entries[actor].digest);
      reveals += 1;
    }
    console.log(step.method, step.hash, receipt.status, receipt.execution);
  }
  assert.equal(reveals, round.ranking.length);
  return {
    round: round.key, bins: round.bins, commitment_matches: reveals,
    ranking: round.ranking.map((row) => ({ actor: row.actor, rank: row.rank, brier: brier(row.loss_sum) })),
    readback: "MATCH",
  };
}

const replays = [];
for (const run of [journal, browser]) replays.push(await verifyRound(run));
console.log(JSON.stringify({ address: manifest.address, source_verified: true, replays }, null, 2));
