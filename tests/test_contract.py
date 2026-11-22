import copy
import json
import sys
import types
import unittest

STATE = types.SimpleNamespace()
PUBLIC = types.SimpleNamespace(write=lambda f: f, view=lambda f: f)
GL = types.SimpleNamespace(Contract=object, public=PUBLIC, message=STATE,
                           message_raw={"datetime": "2026-11-22T12:00:00Z"})
sys.modules["genlayer"] = types.SimpleNamespace(gl=GL, TreeMap=dict, DynArray=list, u256=int)

from contracts import field_index as contract

HOST = "0x" + "11" * 20
PLAYER = "0x" + "22" * 20
ADDRESS = "0x" + "33" * 20
SALT = "ab" * 32
VALUES = [10, 20, 30, 40, 50, 60, 70, 80]
DAY = "2024-05-12"
GFZ = {
    "datetime": [f"{DAY}T{hour}:00:00Z" for hour in contract.HOURS],
    "status": ["def"] * 8,
    "Kp": [6.333, 7.0, 3.667, 4.333, 2.0, 3.0, 4.0, 6.333],
}


class FieldIndexTest(unittest.TestCase):
    def setUp(self):
        GL.message_raw["datetime"] = "2026-11-22T12:00:00Z"
        STATE.sender_address = HOST
        STATE.contract_address = ADDRESS
        self.book = contract.FieldIndex()
        self.book.rounds = {}
        self.book.directory = []
        GL.nondet = types.SimpleNamespace(web=types.SimpleNamespace(
            request=lambda *_args, **_kwargs: types.SimpleNamespace(status=200, body=json.dumps(GFZ).encode())
        ))
        GL.eq_principle = types.SimpleNamespace(strict_eq=lambda fetch: fetch())

    def state(self, key):
        return json.loads(self.book.get_round(key))

    def test_replay_two_accounts_and_permissionless_settlement(self):
        key = self.book.open_round("replay", DAY, "REPLAY")
        STATE.sender_address = PLAYER
        self.book.seal(key, contract.commitment(ADDRESS, key, PLAYER, VALUES, SALT))
        with self.assertRaisesRegex(ValueError, "replay host"):
            self.book.advance_replay(key)
        with self.assertRaisesRegex(ValueError, "available for reveal"):
            self.book.reveal(key, VALUES, SALT)
        STATE.sender_address = HOST
        self.book.advance_replay(key)
        STATE.sender_address = PLAYER
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.book.reveal(key, VALUES[:-1] + [81], SALT)
        self.book.reveal(key, VALUES, SALT)
        STATE.sender_address = HOST
        self.book.advance_replay(key)
        STATE.sender_address = PLAYER
        self.book.settle(key)
        row = self.state(key)
        self.assertEqual(row["bins"], [6333, 7000, 3667, 4333, 2000, 3000, 4000, 6333])
        self.assertEqual(row["ranking"][0]["losses"], [8100, 6400, 900, 1600, 2500, 3600, 4900, 400])
        self.assertEqual(row["settler"], PLAYER)
        with self.assertRaisesRegex(ValueError, "not ready"):
            self.book.settle(key)
        self.assertEqual(self.state(key), row)

    def test_live_uses_transaction_utc_day(self):
        key = self.book.open_round("tomorrow", "2026-11-23", "LIVE")
        self.book.seal(key, contract.commitment(ADDRESS, key, HOST, VALUES, SALT))
        with self.assertRaises(ValueError):
            self.book.advance_replay(key)
        GL.message_raw["datetime"] = "2026-11-23T00:00:00Z"
        STATE.sender_address = PLAYER
        with self.assertRaisesRegex(ValueError, "Commit phase closed"):
            self.book.seal(key, SALT)
        STATE.sender_address = HOST
        self.book.reveal(key, VALUES, SALT)
        with self.assertRaisesRegex(ValueError, "not ready"):
            self.book.settle(key)
        GL.message_raw["datetime"] = "2026-11-25T00:00:00Z"
        self.assertEqual(self.book._phase(self.state(key)), "AWAITING_DATA")

    def test_failed_consensus_preserves_round(self):
        key = self.book.open_round("missing", DAY, "REPLAY")
        self.book.advance_replay(key)
        self.book.advance_replay(key)
        before = self.state(key)

        def disagree(fetch):
            self.assertEqual(len(fetch()), 8)
            raise ValueError("Validator disagreement")

        GL.eq_principle.strict_eq = disagree
        with self.assertRaisesRegex(ValueError, "Validator disagreement"):
            self.book.settle(key)
        self.assertEqual(self.state(key), before)

    def test_nondefinitive_incomplete_and_invalid_precision_rejected(self):
        for field, value in [
            ("status", ["nowcast"] * 8),
            ("Kp", GFZ["Kp"][:-1]),
            ("Kp", [6.334] + GFZ["Kp"][1:]),
            ("Kp", [True] + GFZ["Kp"][1:]),
            ("datetime", GFZ["datetime"][::-1]),
        ]:
            with self.subTest(field=field, value=value):
                raw = copy.deepcopy(GFZ)
                raw[field] = value
                with self.assertRaises(ValueError):
                    contract.normalize_gfz(raw, DAY)

    def test_rank_ties_and_unrevealed(self):
        entries = {PLAYER: {"probabilities": VALUES}, HOST: {"probabilities": VALUES},
                   ADDRESS: {"probabilities": None}}
        scores = contract.rank(entries, [0] * 8)
        self.assertEqual([(score["actor"], score["rank"]) for score in scores], [(HOST, 1), (PLAYER, 1)])

    def test_canonical_sha256(self):
        self.assertEqual(contract.commitment(ADDRESS, HOST + "/replay", PLAYER, VALUES, SALT),
                         "cdc9d196efc587147aeccadc6f35eea4483d2a09f2f971dea2c9c0ea31252db8")

    def test_keys_are_owner_qualified_and_immutable(self):
        first = self.book.open_round("duplicate", DAY, "REPLAY")
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.book.open_round("duplicate", DAY, "REPLAY")
        STATE.sender_address = PLAYER
        second = self.book.open_round("duplicate", DAY, "REPLAY")
        self.assertEqual(json.loads(self.book.recent_rounds()), [second, first])


if __name__ == "__main__":
    unittest.main()
