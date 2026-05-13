"""
Telegram announcement UI — Pyrogram bot broadcast sa listahan ng chat/user IDs.
"""
import asyncio
import os
import sys
import warnings
from pathlib import Path

# Python 3.12+ / 3.14: Pyrogram import kailangan ng default event loop (Streamlit + Pyrogram).
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

import streamlit as st
from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.errors import (
    FloodWait,
    PeerIdInvalid,
    UserIsBlocked,
    InputUserDeactivated,
)

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")


def parse_ids(text: str) -> list[int]:
    out: list[int] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            out.append(int(line))
        except ValueError:
            continue
    return out


async def send_announcement(
    api_id: int,
    api_hash: str,
    bot_token: str,
    chat_ids: list[int],
    message: str,
    delay_seconds: float = 0.05,
) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    ok: list[tuple[int, str]] = []
    err: list[tuple[int, str]] = []

    app = Client(
        "announce_bot",
        api_id=api_id,
        api_hash=api_hash,
        bot_token=bot_token,
        workdir=str(BASE),
    )

    await app.start()
    try:
        for cid in chat_ids:
            try:
                await app.send_message(cid, message)
                ok.append((cid, "sent"))
            except FloodWait as e:
                err.append((cid, f"FloodWait {e.value}s"))
                await asyncio.sleep(float(e.value))
            except UserIsBlocked:
                err.append((cid, "user blocked bot"))
            except InputUserDeactivated:
                err.append((cid, "account deactivated"))
            except PeerIdInvalid:
                err.append((cid, "invalid peer / hindi pa nakikipag-usap sa bot"))
            except Exception as ex:  # noqa: BLE001
                err.append((cid, str(ex)))
            await asyncio.sleep(delay_seconds)
    finally:
        await app.stop()

    return ok, err


def main() -> None:
    st.set_page_config(page_title="Telegram Announcement", layout="centered")
    st.title("Telegram announcement")
    st.caption("Pyrogram bot — magpadala sa mga guest chat/user ID")

    with st.expander("Setup (unang beses)"):
        st.markdown(
            """
1. **my.telegram.org** — kunin ang `api_id` at `api_hash`.
2. **@BotFather** — gumawa ng bot, kunin ang `TELEGRAM_BOT_TOKEN`.
3. I-copy ang `env.example` → `.env` sa folder na ito at punan ang values.
4. Ang bawat guest dapat **na-/start na ang bot** mo (para makatanggap ng DM).
5. Ilagay ang mga chat/user ID (isang numero bawat linya) sa text box o sa `guests.txt`.
            """
        )

    api_id_s = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    default_file = os.getenv("GUEST_CHAT_IDS_FILE", "guests.txt").strip()

    if not api_id_s or not api_hash or not bot_token:
        st.warning("Kulang ang `.env`: kailangan `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_BOT_TOKEN`.")
        return

    try:
        api_id = int(api_id_s)
    except ValueError:
        st.error("`TELEGRAM_API_ID` dapat integer.")
        return

    path_default = BASE / default_file
    default_text = ""
    if path_default.is_file():
        default_text = path_default.read_text(encoding="utf-8")

    ids_input = st.text_area(
        "Mga chat / user ID (isang ID bawat linya)",
        value=default_text,
        height=200,
        placeholder="123456789\n-1001234567890",
    )

    message = st.text_area("Mensahe ng announcement", height=180)

    col1, col2 = st.columns(2)
    with col1:
        delay = st.number_input("Delay pagitan ng mensahe (segundo)", min_value=0.0, max_value=5.0, value=0.05, step=0.05)
    with col2:
        dry = st.checkbox("Dry run (bilangin lang ang IDs, walang padala)", value=False)

    chat_ids = parse_ids(ids_input)
    st.info(f"**{len(chat_ids)}** na-parse na ID(s).")

    if st.button("Ipadala", type="primary", disabled=not message.strip() or not chat_ids):
        if dry:
            st.success(f"Dry run: sana’y magpapadala sa {len(chat_ids)} recipient(s).")
            return

        progress = st.progress(0.0)
        status = st.empty()
        status.info("Nagpapadala…")

        async def run() -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
            return await send_announcement(api_id, api_hash, bot_token, chat_ids, message.strip(), delay_seconds=delay)

        try:
            ok, err = asyncio.run(run())
        except Exception as e:  # noqa: BLE001
            st.error(f"Error: {e}")
            return
        finally:
            progress.progress(1.0)

        status.success(f"Tapos: **{len(ok)}** ok, **{len(err)}** error.")
        if ok:
            st.subheader("Naipadala")
            st.dataframe([{"chat_id": c, "status": s} for c, s in ok], use_container_width=True)
        if err:
            st.subheader("May error")
            st.dataframe([{"chat_id": c, "error": s} for c, s in err], use_container_width=True)


if __name__ == "__main__":
    main()
