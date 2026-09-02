from __future__ import annotations

import base64
import hashlib
import json
import lzma
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SHA256 = "a4197620589bca085eaaad95f5675292efcc23054ee2ee3b1d53d383a74f11c1"
PAYLOAD_PARTS = [ROOT / "scripts" / f"migration.payload.{index:03d}" for index in range(3)]

missing = [str(path.relative_to(ROOT)) for path in PAYLOAD_PARTS if not path.exists()]
if missing:
    raise SystemExit(f"Missing migration payload chunks: {', '.join(missing)}")

encoded = "".join(path.read_text(encoding="utf-8").strip() for path in PAYLOAD_PARTS)
compressed = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(compressed).hexdigest()
if actual != EXPECTED_SHA256:
    raise SystemExit(f"Migration payload checksum mismatch: {actual}")

manifest = json.loads(lzma.decompress(compressed).decode("utf-8"))
if not isinstance(manifest, dict):
    raise SystemExit("Invalid migration payload")

legacy = ROOT / "legacy" / "index.html"
legacy.parent.mkdir(parents=True, exist_ok=True)
if not legacy.exists():
    shutil.copy2(ROOT / "index.html", legacy)

for relative, content in manifest.items():
    if not isinstance(relative, str) or not isinstance(content, str):
        raise SystemExit("Invalid migration entry")
    destination = (ROOT / relative).resolve()
    if ROOT not in destination.parents and destination != ROOT:
        raise SystemExit(f"Unsafe migration path: {relative}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")

print(f"Applied {len(manifest)} migration files; legacy root preserved at {legacy.relative_to(ROOT)}")
