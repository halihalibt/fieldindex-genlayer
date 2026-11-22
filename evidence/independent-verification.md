# Independent Studionet verification

- Verification completed on 2026-11-22 at 13:25:59 UTC (21:25:59 UTC+08:00).
- Source revision [`901342d605a4c0b7ef61dc5a18bbec84d497684f`](https://github.com/halihalibt/fieldindex-genlayer/tree/901342d605a4c0b7ef61dc5a18bbec84d497684f).
- Stable Studionet chain ID 61999 (`0xf22f`).
- Contract [`0xD8f00ddd2aE9ef08AE890938018B73DFAF950fE5`](https://explorer-studio.genlayer.com/address/0xD8f00ddd2aE9ef08AE890938018B73DFAF950fE5).
- Commands run from the repository root: `npm ci --prefer-offline --no-audit --no-fund`, then `npm run verify`. The verifier exited with code 0.

| Check | Observed result |
| --- | --- |
| Deployment identity | The RPC chain ID, recorded contract address, and contract protocol identifier matched. |
| Deployed source | The exact source returned by Studionet matched the repository file. The source SHA-256 matched the deployment journal. The verifier uses the deployed source returned by the SDK. |
| Transaction receipts | All 15 transactions in the two replay journals were `FINALIZED` with `MAJORITY_AGREE` and execution `SUCCESS`. |
| Commit–reveal | All 3 decoded reveal payloads matched the recorded probability vectors and recomputed SHA-256 commitments. |
| Finalized readback | Both replay records exactly matched their saved snapshots, including observations, forecasts, and rankings. |
| Brier scoring | All per-window losses, totals, and ranks matched the independent off-chain calculation. Mean scores were `0.0928` and `0.1477` for May Disturbance and `0.2203` for May Recovery. |

This run queried existing records. It exercised neither wallet signing nor new transaction submission. Its receipt checks cover the two recorded successful replays. The [initial failed settlement](README.md#initial-deployment-incident) remains documented separately.
