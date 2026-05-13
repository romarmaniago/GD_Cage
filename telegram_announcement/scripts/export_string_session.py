"""
One-time: mag-login bilang Telegram USER at i-print ang TELEGRAM_STRING_SESSION
para ilagay sa telegram_announcement/.env (headless broadcast mula sa Node).

Run mula sa telegram_announcement folder:
  .venv\\Scripts\\python scripts\\export_string_session.py
"""
import asyncio
import sys
import warnings

# Python 3.12+ / 3.14: walang default event loop; Pyrogram nag-i-import ng sync shim na tumatawag sa get_event_loop().
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent
load_dotenv(REPO_ROOT / ".env")
load_dotenv(ROOT / ".env", override=True)


async def main() -> None:
    print(
        "\nNumero: international format na may + at country code "
        "(PH hal. +639929061244, hindi 09929061244).\n",
        file=sys.stderr,
    )
    api_id_s = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    if not api_id_s or not api_hash:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in .env", file=sys.stderr)
        sys.exit(1)
    api_id = int(api_id_s)

    app = Client(
        "broadcast_mtproto",
        api_id=api_id,
        api_hash=api_hash,
        workdir=str(ROOT),
    )
    async with app:
        s = await app.export_session_string()
    print("\n--- Ilagay ito sa .env bilang: TELEGRAM_STRING_SESSION=... ---\n")
    print(s)
    print(
        "\n--- HUWAG burahin ang telegram_announcement/broadcast_mtproto.session kung gagamit ka ng numeric chat ID: "
        "ini-store doon ang peer cache. String-only session = memory lang → madalas gumagana ang @username pero hindi ang ID. ---\n",
        file=sys.stderr,
    )


if __name__ == "__main__":
    asyncio.run(main())
