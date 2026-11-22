export const PROTOCOL = "field-index-1";
export const HOURS = ["00", "03", "06", "09", "12", "15", "18", "21"];
export const ARCHIVE_DAY = "2024-05-11";
export const SOURCE = "https://kp.gfz.de/en/data";
export const REPO = "https://github.com/halihalibt/fieldindex-genlayer";
export const EXPLORER = "https://explorer-studio.genlayer.com";
export const HEX64 = /^[0-9a-f]{64}$/;
export const ROUND_KEY = /^0x[0-9a-f]{40}\/[a-z0-9][a-z0-9-]{2,31}$/;

export function phaseOf(round, today = new Date().toISOString().slice(0, 10)) {
  if (round.bins) return "SETTLED";
  if (round.mode === "REPLAY") return round.replay_phase;
  if (today < round.day) return "COMMIT";
  return today < round.reveal_until ? "REVEAL" : "AWAITING_DATA";
}

export function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function commitment(contract, key, actor, values, salt) {
  const message = [PROTOCOL, "61999", contract.toLowerCase(), key, actor.toLowerCase(), values.join(","), salt].join("|");
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message))));
}

export function freshSalt() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function brier(lossSum) {
  return (lossSum / 80000).toFixed(4);
}

export function auditSettlement(round) {
  const bins = round?.bins;
  if (!Array.isArray(bins) || bins.length !== 8 || bins.some((value) =>
    !Number.isInteger(value) || value < 0 || value > 9000 || ![0, 333, 667].includes(value % 1000))) {
    return { match: false, reason: "Invalid eight-bin observation." };
  }
  const expected = [];
  const events = bins.map((value) => Number(value >= 5000));
  for (const [actor, entry] of Object.entries(round.entries)) {
    if (entry.probabilities === null) continue;
    const vector = entry.probabilities;
    if (!Array.isArray(vector) || vector.length !== 8 || vector.some((value) =>
      !Number.isInteger(value) || value < 0 || value > 100)) {
      return { match: false, reason: "Invalid revealed probability vector." };
    }
    const losses = vector.map((p, index) => (p - 100 * events[index]) ** 2);
    expected.push({ actor, losses, loss_sum: losses.reduce((sum, loss) => sum + loss, 0) });
  }
  expected.sort((a, b) => a.loss_sum - b.loss_sum || (a.actor < b.actor ? -1 : 1));
  expected.forEach((row, index) => {
    const prior = expected[index - 1];
    row.rank = prior?.loss_sum === row.loss_sum ? prior.rank : index + 1;
  });
  const match = Array.isArray(round.ranking) && expected.length === round.ranking.length
    && expected.every((row, index) => {
      const stored = round.ranking[index];
      return row.actor === stored?.actor && row.rank === stored.rank && row.loss_sum === stored.loss_sum
        && Array.isArray(stored.losses) && row.losses.length === stored.losses.length
        && row.losses.every((loss, bin) => loss === stored.losses[bin]);
    });
  return { match, events, checked: expected.length, reason: match ? null : "Stored ranking differs from the recomputed ledger." };
}
