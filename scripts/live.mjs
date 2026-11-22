import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createAccount } from "genlayer-js";
import { client, inspectReceipt, read } from "../src/chain.js";
import { ARCHIVE_DAY, commitment, freshSalt, PROTOCOL } from "../src/model.js";

const journalPath = process.argv[2];
if (!journalPath || existsSync(journalPath)) {
  throw Error("Provide a new evidence path, e.g. npm run live -- /tmp/field-index-replay.json");
}
const code = readFileSync("contracts/field_index.py", "utf8");
const journal = { chain: 61999, source_sha256: createHash("sha256").update(code).digest("hex"), steps: [] };
const persist = () => writeFileSync(journalPath, JSON.stringify(journal, (_, v) => typeof v === "bigint" ? String(v) : v, 2) + "\n");
const host = createAccount();
const guest = createAccount();
const observer = createAccount();
const key = host.address.toLowerCase() + "/may-disturbance";
const scoreA = [74, 85, 94, 90, 76, 68, 58, 45];
const scoreB = [48, 64, 73, 80, 86, 78, 61, 33];

async function send(method, submit, check, expectedExecution = "SUCCESS") {
  const hash = await submit();
  const step = { method, hash, expectedExecution };
  journal.steps.push(step);
  persist();
  console.log(method, hash);
  let tx;
  for (let retry = 0; retry < 360; retry += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try { tx = await client.getTransaction({hash}); } catch { continue; }
    const receipt = inspectReceipt(tx);
    if (["FINALIZED", "CANCELED"].includes(receipt.status)) break;
    if (retry % 12 === 0) console.log(method, receipt.status);
  }
  Object.assign(step, inspectReceipt(tx));
  step.raw = tx ?? null;
  persist();
  assert.equal(step.status, "FINALIZED");
  assert.equal(step.consensus, "MAJORITY_AGREE");
  assert.equal(step.execution, expectedExecution);
  step.readback = await check(tx);
  persist();
  console.log(method, step.status, step.execution);
  return step.readback;
}

try {
  const schema = await client.getContractSchemaForCode(code);
  console.log("Schema received", Object.keys(schema));
  const { address } = await send("deploy", () => client.deployContract({ account: host, code, args: [], leaderOnly: false }), async tx => {
    const address = tx.data?.contract_address ?? tx.data?.contractAddress;
    assert.match(address, /^0x[\da-fA-F]{40}$/);
    assert.equal(await client.getContractCode(address), code);
    return { address };
  });
  journal.address = address;
  journal.round = key;
  persist();
  const readRound = () => read(address, "get_round", [key]);
  const call = (method, args, actor, expected, check, label = method) => send(label, () =>
    client.writeContract({ address, account: actor, functionName: method, args, value: 0n, leaderOnly: false }), async () => {
      const row = await readRound();
      check(row);
      return row;
    }, expected);

  await call("open_round", ["may-disturbance", ARCHIVE_DAY, "REPLAY"], host, "SUCCESS", r => assert.equal(r.replay_phase, "COMMIT"));
  const hostSalt = freshSalt();
  const guestSalt = freshSalt();
  const hostSeal = await commitment(address, key, host.address, scoreA, hostSalt);
  const guestSeal = await commitment(address, key, guest.address, scoreB, guestSalt);
  await call("seal", [key, hostSeal], host, "SUCCESS", r => assert.deepEqual(r.entries[host.address.toLowerCase()], {digest: hostSeal, probabilities: null}));
  await call("seal", [key, guestSeal], guest, "SUCCESS", r => assert.deepEqual(r.entries[guest.address.toLowerCase()], {digest: guestSeal, probabilities: null}));
  await call("advance_replay", [key], host, "SUCCESS", r => assert.equal(r.replay_phase, "REVEAL"), "open_reveal");
  await call("reveal", [key, scoreA, hostSalt], host, "SUCCESS", r => assert.deepEqual(r.entries[host.address.toLowerCase()].probabilities, scoreA));
  await call("reveal", [key, scoreB, guestSalt], guest, "SUCCESS", r => assert.deepEqual(r.entries[guest.address.toLowerCase()].probabilities, scoreB));
  await call("advance_replay", [key], host, "SUCCESS", r => assert.equal(r.replay_phase, "AWAITING_DATA"), "close_reveal");
  const result = await call("settle", [key], observer, "SUCCESS", r => {
    assert.deepEqual(r.bins, [9000, 8333, 8333, 9000, 8667, 8333, 7667, 7667]);
    assert.equal(r.ranking.length, 2);
    for (const rank of r.ranking) {
      const expected = r.entries[rank.actor].probabilities.map(p => (p - 100) ** 2);
      assert.deepEqual(rank.losses, expected);
      assert.equal(rank.loss_sum, expected.reduce((a, b) => a + b));
    }
    assert.equal(r.ranking[0].actor, host.address.toLowerCase());
  });
  journal.finalized_readback = result;
  persist();
  console.log(JSON.stringify({ address, protocol: PROTOCOL, demoRound: key, settleTx: journal.steps.at(-1).hash }));
} catch (error) {
  journal.error = String(error);
  persist();
  throw error;
}
