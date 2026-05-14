"""
Revoke ang kasalukuyang Pyrogram USER session (Telegram auth.logOut).
Tinatanggal din ang lokal na broadcast_mtproto.session kung iniwan ng Pyrogram.

Run mula sa repo root:
  npm run broadcast:logout
"""
import asyncio
import sys
import warnings

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


def _cleanup_local_mtproto_files() -> None:
    """Tanggalin ang stale session files para malinis ang next login / export."""
    for p in sorted(ROOT.glob("broadcast_mtproto.session*")):
        if not p.is_file():
            continue
        try:
            p.unlink()
            print(f"Deleted local: {p.name}", file=sys.stderr)
        except OSError as oe:
            print(f"Could not delete {p.name}: {oe}", file=sys.stderr)


def _is_auth_key_dead(exc: BaseException) -> bool:
    s = str(exc).upper()
    return "AUTH_KEY_UNREGISTERED" in s


async def main() -> None:
    api_id_s = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    session_string = os.getenv("TELEGRAM_STRING_SESSION", "").strip()
    session_file = ROOT / "broadcast_mtproto.session"
    has_file = session_file.is_file()

    if not api_id_s or not api_hash:
        print("Missing TELEGRAM_API_ID / TELEGRAM_API_HASH sa .env", file=sys.stderr)
        sys.exit(1)

    try:
        api_id = int(api_id_s)
    except ValueError:
        print("TELEGRAM_API_ID dapat integer.", file=sys.stderr)
        sys.exit(1)

    if not has_file and not session_string:
        print("Walang broadcast_mtproto.session at walang TELEGRAM_STRING_SESSION — wala nang i-lo-log out.", file=sys.stderr)
        return

    if has_file:
        app = Client(
            "broadcast_mtproto",
            api_id=api_id,
            api_hash=api_hash,
            workdir=str(ROOT),
        )
    else:
        app = Client(
            "broadcast_mtproto",
            api_id=api_id,
            api_hash=api_hash,
            session_string=session_string,
            workdir=str(ROOT),
        )

    try:
        async with app:
            await app.log_out()
    except Exception as e:
        if _is_auth_key_dead(e):
            # Key wala na sa Telegram (na-revoke na dati, lumang .session/string, o na-log out na).
            # Hindi na makakatawag ng auth.logOut gamit ang key na ito — epektibong "logged out" na.
            _cleanup_local_mtproto_files()
            print(
                "\nOK (walang server logOut): ang session key ay INVALID na sa Telegram "
                "(AUTH_KEY_UNREGISTERED). Para sa praktika, logged out ka na.\n"
                "Alisin ang TELEGRAM_STRING_SESSION sa .env kung may luma pang naka-set.\n",
                file=sys.stderr,
            )
            return
        print(f"log_out error: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nOK: na-revoke na ang session sa Telegram (auth.logOut).", file=sys.stderr)
    print(
        "Alisin o i-blank ang TELEGRAM_STRING_SESSION sa .env. "
        "Kung may natirang broadcast_mtproto.session, burahin manual.\n",
        file=sys.stderr,
    )


if __name__ == "__main__":
    asyncio.run(main())
