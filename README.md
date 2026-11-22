# Field Index

[Field Index on GitHub Pages](https://halihalibt.github.io/fieldindex-genlayer/)

Field Index is a geomagnetic forecast lab for classrooms, forecast clubs, and independent model builders. Participants seal eight probabilities for Kp reaching 5 during each three-hour UTC interval. The lab scores matching reveals against the definitive planetary Kp data published by GFZ Potsdam.

Two groups can compare forecasts without giving either control of the observation feed or rankings. GenLayer validators fetch the same dated GFZ record independently and compare the full normalized vector through strict equivalence. They must agree on the bins before the Intelligent Contract writes the scores. The host cannot enter a Kp value, award points, or change an observation day.

## Open the instrument

- **Practice** runs locally. Scrub through the tape, set probabilities, and overlay a credited archive sample to inspect per-window loss.
- **Studionet** opens the signed round register. Read the reference replay without a wallet, compare both forecasters, and export the settled record.
- **New round** accepts OKX Wallet, MetaMask, or a temporary in-memory test wallet on Stable Studionet (61999). The app sends zero attached value. It tracks the transaction hash through consensus, finality, execution, and matching finalized storage. Reloading resumes a pending transaction.

In a live forecast, the observation date must be 1–35 UTC days ahead. Seals close at 00:00 UTC at the start of that date. Reveals close at 00:00 UTC two days after the start. The contract uses the transaction's UTC date for eligibility. For an archived replay, its host closes the seal and reveal phases manually. Replay scores are educational and remain visibly marked as replays.

## Protocol

The contract and browser agree on an ordered vector of eight whole percentages. The browser generates a 32-byte salt. The wallet seals the lowercase SHA-256 of the UTF-8 string below.

```text
field-index-1|61999|contract_address|host_address/round_slug|forecaster_address|p0,p1,p2,p3,p4,p5,p6,p7|salt
```

Addresses and salt use lowercase hex. Only the original wallet can reveal, and the contract recomputes the hash. Save a reveal key before leaving the page and keep it private until reveal. Temporary wallets are lost when the page closes or reloads. Each round supports up to 16 distinct wallets. An unrevealed or mismatched commitment receives no score.

| Call | Effect |
| --- | --- |
| `open_round(slug, day, mode)` | Fix the host, UTC day, mode, source, and timing |
| `seal(key, digest)` | Store one commitment for the caller |
| `reveal(key, probabilities, salt)` | Open the caller's matching commitment during REVEAL |
| `advance_replay(key)` | Host-only transition from COMMIT to REVEAL or REVEAL to AWAITING_DATA |
| `settle(key)` | Any wallet may request GFZ consensus after reveals close |
| `get_round(key)`, `recent_rounds()`, `protocol()` | Read a round, the 12 most recent keys, or the protocol identifier |

After the reveal phase, each validator fetches the fixed GFZ URL for the selected UTC day. The contract requires the exact eight timestamps in order, the definitive status on every bin, and valid Kp increments. It compares integer milli-Kp values through `gl.eq_principle.strict_eq`. Missing, provisional, malformed, or presently unavailable data leaves the round unsettled. A later attempt can settle once definitive data is available. A settled round is immutable.

The event for each bin is `Kp >= 5`. For probability `p` in percent, the integer loss is `(p − 100 × event)²`. Sum the eight losses and divide by 80,000 for mean Brier loss. Lower loss ranks higher. Equal losses share a rank and display in address order.

## Verify locally

```bash
npm ci
npm test
npm run dev
npm run build
npm run verify
```

Node.js 22+ and Python 3.11+ are supported. The Python suite uses an explicit GenLayer stand-in for deterministic tests. The verifier independently reads the actual registered receipts and finalized storage, checks the linked deployment against the source bytes, and recomputes every loss. See [network evidence](evidence/README.md).

## Data and limits

The single observation authority is the official [GFZ planetary Kp archive](https://kp.gfz.de/en/data). GenLayer provides independent retrieval and a shared immutable result. It does not independently measure the underlying geomagnetic field. GFZ publishes definitive values monthly, so a live round may remain awaiting data for weeks. If GFZ revises a record after settlement, the original normalized observation remains in the settled record. Wallet addresses are pseudonymous and the lab does not establish distinct human identities. No asset transfer, prize pool, predictive model, or safety alert is part of the protocol.

GFZ Helmholtz Centre for Geosciences, CC BY 4.0. Kp data reference: [Matzka et al., GFZ Data Services](https://doi.org/10.5880/Kp.0001). The magnetic plate is an illustration. Barlow Condensed, IBM Plex Mono, and Instrument Sans are bundled under their [Open Font Licenses](public/assets/).
