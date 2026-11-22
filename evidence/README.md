# Stable Studionet evidence

[Deployment and source](https://explorer-studio.genlayer.com/address/0xD8f00ddd2aE9ef08AE890938018B73DFAF950fE5) · [Reference replay](https://halihalibt.github.io/fieldindex-genlayer/?round=0x4ea69bc3152d000f8940e20c1a188e98865b03a9%2Fmay-disturbance#instrument)

Chain 61999 · RPC https://studio.genlayer.com/api  
Canonical source SHA-256 `ee3129a2f591a5dd7c242d9dfb902f82346e4bac0add44c96f7b17328fc0d516`

## Reference replay

The host and a second wallet committed separate vectors, revealed matching probabilities, and kept their identities in the audit record. A third wallet submitted settlement. The selected date was 11 May 2024 UTC, with definitive GFZ Kp values `9.000, 8.333, 8.333, 9.000, 8.667, 8.333, 7.667, 7.667`. Every transaction used full consensus. The verified readbacks used `latest-final`.

| Method | Transaction | Finalized result |
| --- | --- | --- |
| deploy | [0x0819a1ffcb…](https://explorer-studio.genlayer.com/tx/0x0819a1ffcb889632b0603d9691d29de29195e1db254da531a14822d922eb45b6) | FINALIZED / SUCCESS |
| open_round | [0x819609eb9e…](https://explorer-studio.genlayer.com/tx/0x819609eb9ef9b910ec6588eda0c92d238c91191f95249d4f251941a841c2312a) | FINALIZED / SUCCESS |
| seal | [0x09e549863e…](https://explorer-studio.genlayer.com/tx/0x09e549863e84de6ac2f574d082b95079b68c671207486858a0eb77682054f26a) | FINALIZED / SUCCESS |
| seal | [0xfdb6cd72f9…](https://explorer-studio.genlayer.com/tx/0xfdb6cd72f9aed1abf8a8a94a2004e7d6c9d54c8b2cd7672c69c255f7e32e53b2) | FINALIZED / SUCCESS |
| open_reveal | [0x605699b490…](https://explorer-studio.genlayer.com/tx/0x605699b49023604e2a5fbec888b1afba8802803529f273340d564f34ade40070) | FINALIZED / SUCCESS |
| reveal | [0x1655174c01…](https://explorer-studio.genlayer.com/tx/0x1655174c01b61437c1808a9375bfeedfc46420993fe77849f2bccc0034cf38db) | FINALIZED / SUCCESS |
| reveal | [0xe1b56e242d…](https://explorer-studio.genlayer.com/tx/0xe1b56e242d85287bead1432b0fe558cee43c60b7fcf458fe46d1deaeef3ba2b3) | FINALIZED / SUCCESS |
| close_reveal | [0xf813e0ec4a…](https://explorer-studio.genlayer.com/tx/0xf813e0ec4a5ac96ac7e7f1d359feaee2af77030720e10416a176e6f5b4e77ea6) | FINALIZED / SUCCESS |
| settle | [0x2c4109fcb5…](https://explorer-studio.genlayer.com/tx/0x2c4109fcb519f245430cb1f968ca3260586b3193654acea9732d595b78e87295) | FINALIZED / SUCCESS |

| Rank | Forecaster | Mean Brier loss |
| --- | --- | --- |
| 1 | `0x4ea69bc3152d000f8940e20c1a188e98865b03a9` | 0.0928 |
| 2 | `0x2cbb74a026caccc0eee4bd981d9c4cfc6f7eaa53` | 0.1477 |

[Structured evidence and readbacks](studionet.json) · [Unedited SDK receipt journal](studionet-v2-raw.json.gz)

## Initial deployment incident

The [original settlement](https://explorer-studio.genlayer.com/tx/0x4a5a314317ebffb9ed430b8f3c79a687db320a956eeb43ecdce4bdf102c5fc68) finalized with execution ERROR. The pinned GenVM response exposes `status`. The initial code tried to access `status_code` and stopped before recording any scores. The current deployment uses `status` and validates nonempty bounded response bytes. The [original transaction journal](studionet-v1-failure.json.gz) preserves the failure and all earlier results from that deployment.

## Reproduce the checks

Run `npm run verify` to read receipts, compare deployed source bytes, fetch the finalized round and independently recalculate scores. The evidence records an archived replay, so it exercises live validators without waiting for a future GFZ publication. No future-day settlement or real-money action is represented here.
