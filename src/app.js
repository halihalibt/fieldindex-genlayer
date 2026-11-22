import "./style.css";
import { client, connect, guestWallet, inspectReceipt, read, write } from "./chain.js";
import { ARCHIVE_DAY, auditSettlement, brier, commitment, EXPLORER, freshSalt, HEX64, HOURS, phaseOf, PROTOCOL, ROUND_KEY } from "./model.js";

const $ = (selector) => document.querySelector(selector);
const draftStart = [45, 58, 72, 84, 70, 54, 39, 27];
const archived = [9000, 8333, 8333, 9000, 8667, 8333, 7667, 7667];
const registry = new Map();
const tape = $("#tape");
const notice = $("#notice");
const probability = $("#probability");
let noticeTimer;
let config = {};
let mode = "practice";
let selected = 0;
let pointer = null;
let draft = [...draftStart];
let chainDraft = Array(8).fill(50);
let observed = false;
let round = null;
let roundKey = "";
let selectedActor = null;
let auditKey = null;
let roundError = "";
let roundLoading = false;
let list = [];
let listError = "";
let signer = null;
let removeWalletListener = () => {};
let walletBusy = false;
let submitting = false;
let pending = null;
let checking = false;
let receiptText = "No transaction selected";
let receiptHash = null;
let receiptStep = -1;
let txError = false;
let remoteRequest = 0;

const localKey = () => `field-index:pending:${config.address?.toLowerCase()}`;
const secretKey = (key, actor) => `field-index:seal:${config.address?.toLowerCase()}:${key}:${actor}`;
const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const slug = (key) => key.split("/")[1];
const pad = (value) => String(value).padStart(2, "0");
const isAddress = (value) => typeof value === "string" && /^0x[\da-fA-F]{40}$/.test(value);
const isHash = (value) => typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value);
const dateText = (value) => new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(value + "T00:00:00Z"));
const dateOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function button(text, action, emphasis = false, disabled = false) {
  const node = element("button", text, emphasis ? "primary" : "outline");
  node.type = "button";
  node.disabled = disabled;
  node.addEventListener("click", action);
  return node;
}

function external(text, url) {
  const node = element("a", text, "text-link");
  node.href = url;
  node.target = "_blank";
  node.rel = "noreferrer";
  return node;
}

function report(text, error = false) {
  notice.textContent = text;
  notice.hidden = false;
  notice.classList.toggle("bad", error);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 8500 : 4000);
}

function message(node, text, error = false) {
  node.textContent = text;
  node.classList.toggle("error", error);
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function actorEntry() {
  return signer && round?.entries[signer.address];
}

function recovery() {
  if (!round || !signer) return null;
  return readStorage(secretKey(round.key, signer.address));
}

function drawTape() {
  const practice = mode === "practice";
  const phase = round ? phaseOf(round) : null;
  const probabilities = practice ? draft
    : (round?.entries[selectedActor]?.probabilities ?? actorEntry()?.probabilities
      ?? (phase === "COMMIT" && !actorEntry() ? chainDraft : null));
  const bins = practice ? (observed ? archived : null) : round?.bins;
  const canEdit = practice ? !observed : phase === "COMMIT" && !actorEntry() && !pending && !submitting;
  const reading = bins?.[selected];
  const pct = probabilities?.[selected];
  const loss = typeof pct === "number" && typeof reading === "number"
    ? ((pct / 100 - Number(reading >= 5000)) ** 2).toFixed(3) : "—";

  tape.querySelectorAll(".bin").forEach((item, index) => {
    const value = probabilities?.[index];
    item.style.setProperty("--prob", value ?? 0);
    item.style.setProperty("--has-obs", bins ? "1" : "0");
    item.style.setProperty("--observation", bins ? bins[index] / 90 : 0);
    item.setAttribute("aria-pressed", index === selected);
    item.setAttribute("aria-label", `${HOURS[index]}:00 UTC, forecast ${value === undefined ? "unavailable" : value + " percent"}`);
    item.lastElementChild.textContent = value === undefined ? "—" : value + "%";
  });
  $("#plate").style.setProperty("--scan", selected);
  $("#plate-label").textContent = `WINDOW ${pad(selected + 1)} · UTC`;
  $("#plate-time").textContent = HOURS[selected] + ":00";
  $("#bin-caption").textContent = `${HOURS[selected]}:00–${pad(Number(HOURS[selected]) + 3)}:00 UTC`;
  $("#bin-pct").textContent = pct === undefined ? "—" : pct + "%";
  $("#bin-observed").textContent = reading === undefined ? "—" : (reading / 1000).toFixed(reading % 1000 ? 2 : 0);
  $("#bin-loss").textContent = loss;
  probability.value = pct ?? 0;
  probability.disabled = !canEdit;
  probability.setAttribute("aria-valuetext", pct === undefined ? "Unavailable" : pct + " percent");
}

function selectWindow(index) {
  if (selected === index) return;
  selected = index;
  drawTape();
}

HOURS.forEach((hour, index) => {
  const item = element("button", "", "bin");
  item.type = "button";
  item.append(element("span", hour + ":00", "time"), element("span", "", "plot"), element("span", "", "bin-value"));
  item.addEventListener("click", () => selectWindow(index));
  item.addEventListener("keydown", (event) => {
    const next = { ArrowLeft: (index + 7) % 8, ArrowRight: (index + 1) % 8, Home: 0, End: 7 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectWindow(next);
    tape.children[next].focus();
  });
  tape.append(item);
});

function scrub(event) {
  const { left, width } = tape.getBoundingClientRect();
  const index = Math.max(0, Math.min(7, Math.floor((event.clientX - left) / width * 8)));
  selectWindow(index);
}

tape.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  pointer = event.pointerId;
  scrub(event);
});
window.addEventListener("pointermove", (event) => {
  if (pointer === event.pointerId) scrub(event);
});
for (const eventName of ["pointerup", "pointercancel"]) window.addEventListener(eventName, () => { pointer = null; });
probability.addEventListener("input", () => {
  (mode === "practice" ? draft : chainDraft)[selected] = Number(probability.value);
  drawTape();
});

function renderInstrument() {
  $("#practice-mode").setAttribute("aria-pressed", mode === "practice");
  $("#chain-mode").setAttribute("aria-pressed", mode === "chain");
  const action = $("#tape-actions");
  action.replaceChildren();
  let note;
  if (mode === "practice") {
    const lossSum = draft.reduce((sum, pct, index) => sum + (pct - (archived[index] >= 5000 ? 100 : 0)) ** 2, 0);
    $("#tape-context").textContent = "ARCHIVE PRACTICE · " + dateText(ARCHIVE_DAY).toUpperCase();
    if (observed) action.append(button("Reset tape", () => {
      draft = [...draftStart];
      observed = false;
      renderInstrument();
    }));
    else action.append(button("Overlay archived Kp", () => { observed = true; renderInstrument(); }, true));
    note = observed ? `Mean Brier loss ${brier(lossSum)} · GFZ definitive archive · offline practice`
      : "Drag across the tape or use arrow keys to select a window. This practice round runs locally.";
  } else if (!round) {
    $("#tape-context").textContent = "STUDIONET · NO ROUND LOADED";
    const label = config.demoRound ? "Read settled replay" : "Browse rounds";
    action.append(button(label, () => config.demoRound ? loadRound(config.demoRound) : scrollToSection("rounds"), true));
    note = roundLoading ? "Reading finalized round…" : roundError || "Open a round or enter a shared key in the register.";
  } else {
    const phase = phaseOf(round);
    const entry = actorEntry();
    const blocked = submitting || Boolean(pending);
    $("#tape-context").textContent = `${round.mode} · ${dateText(round.day).toUpperCase()} · ${phase.replaceAll("_", " ")}`;
    if (!signer && phase !== "SETTLED") action.append(button("Connect to participate", openWallet, true));
    if (signer && phase === "COMMIT" && !entry) action.append(button("Seal forecast", seal, true, blocked));
    if (entry && phase !== "SETTLED" && recovery()) {
      action.append(button("Save reveal key", () => download(`field-index-${slug(round.key)}-reveal.json`, recovery())));
    }
    if (signer && phase === "REVEAL" && entry && !entry.probabilities) {
      action.append(button("Reveal forecast", reveal, true, blocked));
      action.append(button("Import key", () => $("#recovery-file").click(), false, blocked));
    }
    if (signer?.address === round.host && round.mode === "REPLAY" && ["COMMIT", "REVEAL"].includes(phase)) {
      const target = phase === "COMMIT" ? "REVEAL" : "AWAITING_DATA";
      action.append(button(phase === "COMMIT" ? "Close commits" : "Close reveals", () => submit("advance_replay", [round.key], { phase: target }), false, blocked));
    }
    if (signer && phase === "AWAITING_DATA") action.append(button("Settle with GFZ", () => submit("settle", [round.key], {}), true, blocked));
    const notes = {
      COMMIT: entry ? "Your commitment is recorded. Save the reveal key before closing this browser." : "Set all eight probabilities. Only the commitment hash is published during this phase.",
      REVEAL: "Only the original wallet and matching reveal key can open a commitment.",
      AWAITING_DATA: "The validator committee must agree on all eight definitive bins before scoring can finish.",
      SETTLED: "The observation tape and rankings come from finalized contract storage. Select an entry below to inspect its forecast.",
    };
    note = notes[phase];
  }
  message($("#tape-message"), note ?? "", Boolean(roundError && !roundLoading && !round && mode === "chain"));
  drawTape();
}

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ block: "start", behavior: "auto" });
}

function modeTo(value) {
  mode = value;
  renderInstrument();
}

function urlFor(key) {
  const url = new URL(location.href);
  url.searchParams.set("round", key);
  url.hash = "instrument";
  return url;
}

async function loadRound(key, { silent = false } = {}) {
  key = key.trim().toLowerCase();
  if (!silent) {
    roundError = "";
    mode = "chain";
  }
  if (!ROUND_KEY.test(key) || !isAddress(config.address)) {
    if (!silent) {
      remoteRequest += 1;
      roundLoading = false;
      round = null;
      roundError = !isAddress(config.address) ? "Studionet deployment data is unavailable." : "Enter a wallet-address/round-name key.";
      renderAll();
    }
    return null;
  }
  const token = ++remoteRequest;
  if (!silent) {
    if (roundKey !== key) {
      round = null;
      selectedActor = null;
      chainDraft = Array(8).fill(50);
    }
    roundKey = key;
    roundLoading = true;
    $("#round-key").value = key;
    history.replaceState(null, "", urlFor(key));
    renderAll();
  }
  try {
    const record = await read(config.address, "get_round", [key]);
    if (!record || record.key !== key) throw Error("No finalized round found for this key.");
    if (token !== remoteRequest) return record;
    round = record;
    roundKey = key;
    if (!record.entries[selectedActor]?.probabilities) selectedActor = record.ranking[0]?.actor ?? null;
    roundError = "";
    return record;
  } catch (error) {
    if (token === remoteRequest && !silent) roundError = error.message || "The network read failed.";
    return null;
  } finally {
    if (token === remoteRequest) {
      roundLoading = false;
      renderAll();
    }
  }
}

async function readDirectory() {
  if (!isAddress(config.address)) {
    listError = "Studionet deployment data is unavailable.";
    renderRegister();
    return;
  }
  try {
    const keys = await read(config.address, "recent_rounds");
    list = Array.isArray(keys) ? keys.filter((key) => ROUND_KEY.test(key)) : [];
    listError = "";
  } catch {
    listError = "The register read failed. A shared key can still be entered above.";
  }
  renderRegister();
}

function renderRegister() {
  const shown = $("#round-list");
  shown.replaceChildren();
  if (listError) shown.append(element("span", listError, "message error"));
  else if (!list.length) shown.append(element("span", "No recent finalized rounds loaded.", "message"));
  for (const key of list) {
    const item = button(slug(key), () => { void loadRound(key); scrollToSection("instrument"); });
    item.setAttribute("aria-current", key === roundKey);
    item.append(element("span", key === config.demoRound ? "REFERENCE REPLAY" : short(key.split("/")[0]), "mono"));
    shown.append(item);
  }
  const detail = $("#round-detail");
  detail.replaceChildren();
  if (roundError) detail.append(element("p", roundError, "message error"));
  if (!round) return;

  const wrap = element("div", "", "detail");
  const top = element("div", "", "detail-top");
  const header = element("div");
  header.append(element("p", `${round.mode} / ${phaseOf(round).replaceAll("_", " ")}`, "eyebrow"),
    element("h3", slug(round.key)), element("p", round.key, "mono"));
  top.append(header, button("Copy round link", async () => {
    try { await navigator.clipboard.writeText(urlFor(round.key).href); report("Round link copied."); }
    catch { report("Copy the round link from the address bar.", true); }
  }));
  wrap.append(top);
  const entries = Object.values(round.entries);
  const reveals = entries.filter((entry) => entry.probabilities).length;
  wrap.append(element("p", `${entries.length} sealed · ${reveals} revealed · revision ${round.revision}`, "mono"));
  if (round.ranking.length) {
    const rankTable = element("table", "", "rank");
    const head = rankTable.createTHead().insertRow();
    ["Rank", "Forecaster", "Brier loss"].forEach((label) => head.append(element("th", label)));
    const body = rankTable.createTBody();
    for (const score of round.ranking) {
      const line = body.insertRow();
      line.insertCell().textContent = String(score.rank);
      const show = button(short(score.actor), () => {
        selectedActor = score.actor;
        modeTo("chain");
        scrollToSection("instrument");
      });
      show.title = score.actor;
      show.setAttribute("aria-label", "Inspect " + score.actor);
      line.insertCell().append(show);
      line.insertCell().textContent = brier(score.loss_sum);
    }
    wrap.append(rankTable);
  } else if (round.bins) {
    wrap.append(element("p", "This round settled without any matching reveals.", "message"));
  }
  const links = element("div", "", "detail-actions");
  links.append(external("GFZ archive record", round.source));
  if (round.bins) {
    links.append(button("Recompute scores", () => {
      auditKey = auditKey === round.key ? null : round.key;
      renderRegister();
      $("#audit-summary")?.focus();
    }));
    links.append(button("Export settled audit", () => download(`${slug(round.key)}-audit.json`, {
      chain: 61999, contract: config.address, protocol: PROTOCOL, readMode: "latest-final",
      settlementTx: round.key === config.demoRound ? config.settleTx : null,
      audit: auditSettlement(round), round,
    })));
  }
  wrap.append(links);
  if (round.bins && auditKey === round.key) {
    const audit = auditSettlement(round);
    const summary = element("div", "", "audit");
    summary.id = "audit-summary";
    summary.tabIndex = -1;
    summary.append(element("p", audit.match
      ? `MATCH · ${audit.checked} reveals × 8 windows recalculated` : `MISMATCH · ${audit.reason}`, "eyebrow"));
    if (audit.match) {
      const strip = element("div", "", "audit-strip");
      audit.events.forEach((event, index) => {
        const item = element("span", `${HOURS[index]}h · ${event ? "YES" : "NO"}`);
        item.dataset.event = String(event);
        strip.append(item);
      });
      summary.append(element("p", "Observed event · Kp at least 5", "message"), strip);
    }
    wrap.append(summary);
  }
  detail.append(wrap);
}

function renderReceipt() {
  message($("#tx-stage"), receiptText, txError);
  $("#steps").querySelectorAll("li").forEach((node, index) => {
    node.className = index < receiptStep ? "complete" : index === receiptStep ? "current" : "";
  });
  const links = $("#tx-links");
  links.replaceChildren();
  if (receiptHash) links.append(external("Transaction in explorer", EXPLORER + "/tx/" + receiptHash));
  if (pending && !checking) links.append(button("Resume tracking", track));
  if (isHash(config.settleTx) && (!receiptHash || receiptHash !== config.settleTx)) {
    links.append(external("Reference settlement", EXPLORER + "/tx/" + config.settleTx));
  }
}

function renderAll() {
  renderInstrument();
  renderRegister();
  renderReceipt();
}

function setSigner(next) {
  removeWalletListener();
  removeWalletListener = () => {};
  signer = next;
  if (signer?.provider?.on) {
    const provider = signer.provider;
    const invalidate = () => {
      setSigner(null);
      report("Wallet account or network changed. Reconnect to continue.");
    };
    provider.on("accountsChanged", invalidate);
    provider.on("chainChanged", invalidate);
    removeWalletListener = () => {
      provider.removeListener?.("accountsChanged", invalidate);
      provider.removeListener?.("chainChanged", invalidate);
    };
  }
  $("#wallet-open").classList.toggle("connected", Boolean(signer));
  $("#wallet-open span").textContent = signer ? short(signer.address) : "Connect wallet";
  $("#wallet-open").title = signer ? signer.kind + " · " + signer.address : "";
  $("#wallet-options [data-wallet='disconnect']").hidden = !signer;
  renderAll();
}

function openWallet() {
  message($("#wallet-message"), "");
  const dialog = $("#wallet-dialog");
  if (!dialog.open) dialog.showModal();
}

function setTx(text, step, error = false) {
  receiptText = text;
  receiptStep = step;
  txError = error;
  renderReceipt();
}

function verifies(record, operation) {
  if (!record || record.key !== operation.key) return false;
  const expected = operation.expected;
  if (operation.method === "open_round") return record.mode === expected.mode && record.day === expected.day && record.host === operation.actor;
  if (operation.method === "seal") return record.entries[operation.actor]?.digest === expected.digest;
  if (operation.method === "reveal") return record.entries[operation.actor]?.probabilities?.join(",") === expected.values.join(",");
  if (operation.method === "advance_replay") {
    const phases = ["COMMIT", "REVEAL", "AWAITING_DATA", "SETTLED"];
    return phases.indexOf(phaseOf(record)) >= phases.indexOf(expected.phase);
  }
  if (operation.method === "settle") return phaseOf(record) === "SETTLED" && record.settler === operation.actor && record.bins?.length === 8;
  return false;
}

function clearPending() {
  pending = null;
  try { localStorage.removeItem(localKey()); } catch { /* The active tracker can still finish. */ }
  renderAll();
}

async function track() {
  if (!pending || checking) return;
  checking = true;
  renderReceipt();
  const operation = pending;
  const stopAt = Date.now() + 5 * 60_000;
  try {
    while (Date.now() < stopAt) {
      if (document.hidden) await new Promise(resolve => setTimeout(resolve, 1600));
      try {
        const receipt = inspectReceipt(await client.getTransaction({ hash: operation.hash }));
        if (receipt.status === "CANCELED") {
          setTx("Canceled on Studionet", 2, true);
          clearPending();
          return;
        }
        if (receipt.status === "FINALIZED") {
          if (!receipt.success) {
            const detail = typeof receipt.detail === "string" && receipt.detail.length < 240 ? " · " + receipt.detail : "";
            setTx(`FINALIZED / ${receipt.execution ?? "unknown execution"}${detail}`, 2, true);
            clearPending();
            report("Transaction finalized without a successful execution.", true);
            return;
          }
          setTx("FINALIZED / SUCCESS · checking readback", 3);
          const record = await read(config.address, "get_round", [operation.key]);
          if (verifies(record, operation)) {
            if (roundKey === operation.key || operation.method === "open_round") {
              remoteRequest += 1;
              round = record;
              roundKey = record.key;
              roundLoading = false;
              roundError = "";
              selectedActor = record.ranking[0]?.actor ?? null;
              mode = "chain";
              $("#round-key").value = record.key;
              history.replaceState(null, "", urlFor(record.key));
            }
            setTx("FINALIZED / SUCCESS · Readback verified", 4);
            clearPending();
            report("Finalized on Studionet. Contract state verified.");
            void readDirectory();
            return;
          }
          setTx("FINALIZED / SUCCESS · waiting for matching state", 3);
        } else {
          setTx(receipt.status.replaceAll("_", " ") + (receipt.status === "ACCEPTED" ? " · awaiting finality" : ""), receipt.status === "ACCEPTED" ? 2 : 1);
        }
      } catch {
        setTx("Studionet read interrupted · retrying", Math.max(receiptStep, 1));
      }
      await new Promise(resolve => setTimeout(resolve, 2600));
    }
    setTx("Tracking paused · resume by transaction hash", Math.max(receiptStep, 1));
  } finally {
    checking = false;
    renderReceipt();
  }
}

async function submit(method, args, expected, key = round?.key) {
  if (!signer) { openWallet(); return false; }
  if (!isAddress(config.address)) { report("Studionet deployment data is unavailable.", true); return false; }
  if (pending || submitting) { report("An existing transaction is still being tracked.", true); return false; }
  submitting = true;
  renderInstrument();
  const active = signer;
  setTx("Waiting for " + active.kind, 0);
  try {
    const hash = await write(config.address, active, method, args);
    if (!isHash(hash)) throw Error("Studionet did not return a transaction hash.");
    pending = { hash, key, actor: active.address, method, expected };
    receiptHash = hash;
    try { localStorage.setItem(localKey(), JSON.stringify(pending)); }
    catch { report("Browser storage is unavailable. Keep this tab open to track the transaction.", true); }
    setTx("Submitted to Studionet", 1);
    report("Submitted. The receipt tracks consensus, finality and readback.");
    void track();
    return true;
  } catch (error) {
    setTx(error.shortMessage || error.message || "The wallet write failed.", 0, true);
    report(receiptText, true);
    return false;
  } finally {
    submitting = false;
    renderInstrument();
  }
}

async function seal() {
  if (!round || !signer || pending || submitting) return;
  const key = round.key;
  const actor = signer.address;
  const salt = freshSalt();
  const values = [...chainDraft];
  const digest = await commitment(config.address, key, actor, values, salt);
  if (round?.key !== key || signer?.address !== actor || pending || submitting) return;
  const saved = { protocol: PROTOCOL, contract: config.address, key, actor, values, salt, digest };
  try {
    localStorage.setItem(secretKey(key, actor), JSON.stringify(saved));
  } catch {
    report("The browser could not store your reveal key. Enable site storage before sealing.", true);
    return;
  }
  await submit("seal", [key, digest], { digest }, key);
}

async function reveal() {
  const saved = recovery();
  const entry = actorEntry();
  if (!saved || saved.digest !== entry?.digest) {
    report("Import the reveal key that matches this commitment.", true);
    return;
  }
  await submit("reveal", [round.key, saved.values, saved.salt], { values: saved.values });
}

$("#recovery-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !round || !signer) return;
  if (file.size > 10_240) { report("The reveal key file exceeds 10 KB.", true); return; }
  const key = round.key;
  const actor = signer.address;
  const entry = actorEntry();
  try {
    const saved = JSON.parse(await file.text());
    if (saved.protocol !== PROTOCOL || saved.contract?.toLowerCase() !== config.address.toLowerCase()
      || saved.key !== key || saved.actor !== actor || !HEX64.test(saved.salt)
      || !Array.isArray(saved.values) || saved.values.length !== 8
      || !saved.values.every((p) => Number.isInteger(p) && p >= 0 && p <= 100)) throw Error("Invalid key.");
    saved.digest = await commitment(config.address, key, actor, saved.values, saved.salt);
    if (saved.digest !== entry?.digest) throw Error("Commitment mismatch.");
    localStorage.setItem(secretKey(key, actor), JSON.stringify(saved));
    report("Reveal key restored.");
    renderInstrument();
  } catch {
    report("That file does not match this wallet and commitment.", true);
  }
});

window.addEventListener("eip6963:announceProvider", (event) => {
  if (event.detail?.info?.rdns && event.detail.provider?.request) registry.set(event.detail.info.rdns, event.detail.provider);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
$("#wallet-open").addEventListener("click", openWallet);
$("#wallet-options").addEventListener("click", async (event) => {
  const kind = event.target.closest("[data-wallet]")?.dataset.wallet;
  if (!kind || walletBusy) return;
  walletBusy = true;
  const options = [...$("#wallet-options").querySelectorAll("button")];
  options.forEach((option) => { option.disabled = true; });
  try {
    setSigner(kind === "disconnect" ? null : kind === "guest" ? guestWallet() : await connect(kind, registry));
    $("#wallet-dialog").close();
  } catch (error) {
    message($("#wallet-message"), error.shortMessage || error.message || "Wallet connection failed.", true);
  } finally {
    walletBusy = false;
    options.forEach((option) => { option.disabled = false; });
  }
});

for (const close of document.querySelectorAll("[data-close]")) {
  close.addEventListener("click", () => close.closest("dialog").close());
}
$("#practice-mode").addEventListener("click", () => modeTo("practice"));
$("#chain-mode").addEventListener("click", () => {
  if (!round && !roundKey && config.demoRound) void loadRound(config.demoRound);
  else modeTo("chain");
});
$("#lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadRound($("#round-key").value);
});
$("#new-round").addEventListener("click", () => {
  if (!isAddress(config.address)) { report("Studionet deployment data is unavailable.", true); return; }
  if (!signer) { openWallet(); return; }
  message($("#round-message"), "");
  $("#round-dialog").showModal();
});

function configureDate() {
  const day = $("#round-day");
  const live = $("#round-mode").value === "LIVE";
  day.min = live ? dateOffset(1) : "1932-01-01";
  day.max = live ? dateOffset(35) : dateOffset(-1);
  day.value = live ? day.min : ARCHIVE_DAY;
  $("#round-rule").textContent = live ? "Commits close at 00:00 UTC on this date. Reveals close two days later."
    : "The host closes each practice phase. The date must have eight definitive GFZ observations to settle.";
}

$("#round-mode").addEventListener("change", configureDate);
$("#open-round").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!signer) { $("#round-dialog").close(); openWallet(); return; }
  const name = $("#round-slug").value.trim();
  const key = signer.address + "/" + name;
  const day = $("#round-day").value;
  const selectedMode = $("#round-mode").value;
  if (!ROUND_KEY.test(key)) { message($("#round-message"), "Use 3–32 lowercase letters, digits or hyphens.", true); return; }
  const sent = await submit("open_round", [name, day, selectedMode], { day, mode: selectedMode }, key);
  if (sent) {
    $("#round-dialog").close();
    scrollToSection("rounds");
  } else message($("#round-message"), receiptText, true);
});

function clock() {
  $("#utc-clock").textContent = new Date().toISOString().slice(11, 19) + " UTC";
}
clock();
setInterval(clock, 1000);
configureDate();
renderAll();

async function boot() {
  try {
    const response = await fetch("./deployment.json", { cache: "no-cache" });
    if (response.ok) config = await response.json();
  } catch { /* Practice runs offline. */ }
  if (isAddress(config.address)) {
    const contract = $("#contract-link");
    contract.href = EXPLORER + "/address/" + config.address;
    contract.target = "_blank";
    contract.rel = "noreferrer";
    contract.hidden = false;
    const restored = readStorage(localKey());
    if (isHash(restored?.hash) && ROUND_KEY.test(restored.key)) {
      pending = restored;
      receiptHash = pending.hash;
      void track();
    }
    const key = new URL(location.href).searchParams.get("round") || pending?.key;
    if (key) void loadRound(key);
  }
  void readDirectory();
  renderAll();
}

void boot();
setInterval(() => {
  if (mode !== "chain" || !round || document.hidden || pending) return;
  void loadRound(round.key, { silent: true });
}, 20_000);
