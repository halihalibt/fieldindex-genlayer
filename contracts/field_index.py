# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
import re
from datetime import date, timedelta

from genlayer import *

PROTOCOL = "field-index-1"
GFZ = "https://kp.gfz.de/app/json/"
MAX_ENTRIES = 16
HEX64 = re.compile(r"[0-9a-f]{64}")
HOURS = ("00", "03", "06", "09", "12", "15", "18", "21")


def calendar_day(value: str) -> date:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Date must be YYYY-MM-DD")
    day = date.fromisoformat(value)
    if day < date(1932, 1, 1) or day > date(9998, 12, 31):
        raise ValueError("Date outside supported range")
    return day


def tx_day() -> date:
    return date.fromisoformat(gl.message_raw["datetime"][:10])


def source_url(day: str) -> str:
    return f"{GFZ}?start={day}T00:00:00Z&end={day}T23:59:59Z&index=Kp&status=def"


def normalize_gfz(raw: dict, day: str) -> list[int]:
    times = [day + "T" + hour + ":00:00Z" for hour in HOURS]
    if (raw.get("datetime") != times or raw.get("status") != ["def"] * 8
            or not isinstance(raw.get("Kp"), list) or len(raw["Kp"]) != 8):
        raise ValueError("Eight definitive GFZ bins are required")
    bins = []
    for value in raw["Kp"]:
        if type(value) not in (int, float) or not 0 <= value <= 9:
            raise ValueError("Invalid GFZ Kp value")
        milli = round(value * 1000)
        if abs(value * 1000 - milli) > 0.000001 or milli % 1000 not in (0, 333, 667):
            raise ValueError("Unexpected Kp precision")
        bins.append(milli)
    return bins


def observe(day: str) -> list[int]:
    response = gl.nondet.web.request(source_url(day), method="GET")
    if response.status != 200 or not response.body or len(response.body) > 16_384:
        raise ValueError("GFZ archive unavailable")
    return normalize_gfz(json.loads(response.body), day)


def commitment(contract: str, key: str, actor: str, probabilities: list[int], salt: str) -> str:
    vector = ",".join(str(value) for value in probabilities)
    message = f"{PROTOCOL}|61999|{contract}|{key}|{actor}|{vector}|{salt}"
    return hashlib.sha256(message.encode()).hexdigest()


def rank(entries: dict, bins: list[int]) -> list[dict]:
    results = []
    for actor, entry in entries.items():
        probabilities = entry["probabilities"]
        if probabilities is None:
            continue
        losses = [(probability - (100 if kp >= 5000 else 0)) ** 2
                  for probability, kp in zip(probabilities, bins)]
        results.append({"actor": actor, "losses": losses, "loss_sum": sum(losses)})
    results.sort(key=lambda row: (row["loss_sum"], row["actor"]))
    position = 0
    previous = None
    for index, row in enumerate(results):
        if row["loss_sum"] != previous:
            position = index + 1
            previous = row["loss_sum"]
        row["rank"] = position
    return results


class FieldIndex(gl.Contract):
    rounds: TreeMap[str, str]
    directory: DynArray[str]

    def __init__(self):
        pass

    def _actor(self) -> str:
        return str(gl.message.sender_address).lower()

    def _round(self, key: str) -> dict:
        encoded = self.rounds.get(key, "")
        if not encoded:
            raise ValueError("Unknown round")
        return json.loads(encoded)

    def _write(self, key: str, row: dict) -> None:
        row["revision"] += 1
        self.rounds[key] = json.dumps(row, sort_keys=True, separators=(",", ":"))

    def _phase(self, row: dict) -> str:
        if row["bins"] is not None:
            return "SETTLED"
        if row["mode"] == "REPLAY":
            return row["replay_phase"]
        today = tx_day().isoformat()
        if today < row["day"]:
            return "COMMIT"
        if today < row["reveal_until"]:
            return "REVEAL"
        return "AWAITING_DATA"

    @gl.public.write
    def open_round(self, slug: str, day: str, mode: str) -> str:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,31}", slug):
            raise ValueError("Use 3–32 lowercase letters, digits or hyphens")
        if mode not in ("LIVE", "REPLAY"):
            raise ValueError("Invalid round mode")
        target = calendar_day(day)
        today = tx_day()
        if mode == "LIVE" and not today < target <= today + timedelta(days=35):
            raise ValueError("Live days must be within the next 35 UTC days")
        if mode == "REPLAY" and target >= today:
            raise ValueError("A replay requires a past UTC day")
        host = self._actor()
        key = f"{host}/{slug}"
        if self.rounds.get(key, ""):
            raise ValueError("Round key already exists")
        self._write(key, {
            "key": key, "host": host, "day": day, "mode": mode,
            "opened_on": today.isoformat(),
            "reveal_until": (target + timedelta(days=2)).isoformat(),
            "replay_phase": "COMMIT" if mode == "REPLAY" else None,
            "entries": {}, "bins": None, "ranking": [],
            "source": source_url(day), "settler": None, "revision": 0,
        })
        self.directory.append(key)
        return key

    @gl.public.write
    def advance_replay(self, key: str) -> None:
        row = self._round(key)
        if row["host"] != self._actor() or row["mode"] != "REPLAY":
            raise ValueError("Only the replay host can close a practice phase")
        phase = self._phase(row)
        if phase not in ("COMMIT", "REVEAL"):
            raise ValueError("Replay phase already closed")
        row["replay_phase"] = "REVEAL" if phase == "COMMIT" else "AWAITING_DATA"
        self._write(key, row)

    @gl.public.write
    def seal(self, key: str, digest: str) -> None:
        row = self._round(key)
        actor = self._actor()
        if self._phase(row) != "COMMIT":
            raise ValueError("Commit phase closed")
        if actor in row["entries"] or len(row["entries"]) >= MAX_ENTRIES:
            raise ValueError("Entry already exists or round is full")
        if not HEX64.fullmatch(digest):
            raise ValueError("Expected lowercase SHA-256 hex")
        row["entries"][actor] = {"digest": digest, "probabilities": None}
        self._write(key, row)

    @gl.public.write
    def reveal(self, key: str, probabilities: list[u256], salt: str) -> None:
        row = self._round(key)
        actor = self._actor()
        entry = row["entries"].get(actor)
        if self._phase(row) != "REVEAL" or not entry or entry["probabilities"] is not None:
            raise ValueError("No sealed entry available for reveal")
        values = [int(value) for value in probabilities]
        if len(values) != 8 or not all(0 <= value <= 100 for value in values) or not HEX64.fullmatch(salt):
            raise ValueError("Expected eight percentages and a 32-byte salt")
        contract = str(gl.message.contract_address).lower()
        if commitment(contract, key, actor, values, salt) != entry["digest"]:
            raise ValueError("Reveal does not match the sealed commitment")
        entry["probabilities"] = values
        self._write(key, row)

    @gl.public.write
    def settle(self, key: str) -> None:
        row = self._round(key)
        if self._phase(row) != "AWAITING_DATA":
            raise ValueError("Round is not ready to settle")
        day = row["day"]

        def fetch():
            return observe(day)

        bins = gl.eq_principle.strict_eq(fetch)
        row["bins"] = bins
        row["ranking"] = rank(row["entries"], bins)
        row["settler"] = self._actor()
        self._write(key, row)

    @gl.public.view
    def protocol(self) -> str:
        return PROTOCOL

    @gl.public.view
    def get_round(self, key: str) -> str:
        return self.rounds.get(key, "")

    @gl.public.view
    def recent_rounds(self) -> str:
        size = len(self.directory)
        return json.dumps([self.directory[index] for index in range(size - 1, max(-1, size - 13), -1)])
