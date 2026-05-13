"""
Headless broadcast gamit ang Pyrogram USER account (MTProto), hindi bot API.
Tinatawag ng Node: python send_broadcast_user.py <input.json> <output.json>

input.json: { "chat_ids": ["..."], "message": "...", "image_path": "/tmp/..." | null,
              "guest_bot_token": "optional — Bot getChat → @username bago Pyrogram; o TELEGRAM_GUEST_BOT_TOKEN sa .env" }
output.json: { "success": true, "successCount", "failCount", "errors": [{chatId, error}] }
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

# Python 3.12+ / 3.14: kailangan bago mag-import ng Pyrogram (sync shim → get_event_loop).
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

from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.errors import (
    FloodWait,
    PeerIdInvalid,
    RPCError,
    UserIsBlocked,
)


def _format_peer_invalid_hint(self_id: int, peer_token: str, used_file_session: bool) -> str:
    """Telegram PEER_ID_INVALID: session often cannot resolve the user/channel yet."""
    token = peer_token.strip()
    mem_hint = (
        " If you only use TELEGRAM_STRING_SESSION (no broadcast_mtproto.session file), Pyrogram cannot "
        "remember peers between broadcasts — send once using @username, then keep "
        "telegram_announcement/broadcast_mtproto.session on disk (do not delete after export) so numeric IDs work later."
    )
    extra = (
        " This account must already \"know\" the peer in Telegram (e.g. the user messaged you, "
        "you share a group, or use @username). For a quick self-test, put me on its own line (Saved Messages)."
    )
    if used_file_session:
        extra += (
            " (You are using broadcast_mtproto.session — cache is fine; Telegram still refuses this ID until "
            "there is a real link: have them DM your broadcast account, or send one successful message using their @username.)"
        )
    else:
        extra += mem_hint
    if token.isdigit() or (token.startswith("-") and len(token) > 1 and token[1:].isdigit()):
        try:
            tid = int(token)
        except ValueError:
            return extra
        if tid == self_id:
            return ' For self-DM, use me instead of your numeric user id.' + extra
    return extra


def _resolve_chat_ids_via_bot_getchat(chat_ids: list, bot_token: str) -> list:
    """
    Tulad ng routes/telegramData.js getChat: numeric chat_id → @username kung may username
    at kilala ng GUEST bot ang peer. Walang extra dependency (urllib).
    """
    if not bot_token:
        return list(chat_ids)
    out: list = []
    for raw in chat_ids:
        s = str(raw).strip() if raw is not None else ""
        if not s:
            continue
        low = s.lower()
        if low in ("me", "self", "saved", "saved messages") or s.startswith("@"):
            out.append(s)
            continue
        is_num = s.isdigit() or (s.startswith("-") and len(s) > 1 and s[1:].isdigit())
        if not is_num:
            out.append(s)
            continue
        replaced = False
        try:
            qs = urllib.parse.urlencode({"chat_id": s})
            url = f"https://api.telegram.org/bot{bot_token}/getChat?{qs}"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok") and isinstance(data.get("result"), dict):
                un = (data["result"].get("username") or "").strip().lstrip("@")
                if un:
                    out.append(f"@{un}")
                    replaced = True
                    print(f"[pyrogram-broadcast] bot getChat: {s} → @{un}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"[pyrogram-broadcast] bot getChat failed for {s!r}: {e}", file=sys.stderr)
        if not replaced:
            out.append(s)
        time.sleep(0.05)
    return out


def _peer_prefer_username(resolved: object) -> object:
    """
    Kapag may public username ang na-resolve na User/Chat, gamitin ang @username sa send.
    Walang Telegram API na "ID → username" kung hindi pa ma-resolve ang peer; kailangan munang
    pumasa ang get_users/get_chat.
    """
    un = getattr(resolved, "username", None)
    if un and str(un).strip():
        return f"@{str(un).strip().lstrip('@')}"
    return resolved


ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent
load_dotenv(REPO_ROOT / ".env")
load_dotenv(ROOT / ".env", override=True)


def fail(out_path: str, msg: str) -> None:
    Path(out_path).write_text(
        json.dumps(
            {
                "success": False,
                "error": msg,
                "successCount": 0,
                "failCount": 0,
                "errors": [],
            }
        ),
        encoding="utf-8",
    )


async def run_broadcast(payload: dict, out_path: str) -> None:
    api_id_s = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    session_string = os.getenv("TELEGRAM_STRING_SESSION", "").strip()
    session_file = ROOT / "broadcast_mtproto.session"
    has_file_session = session_file.is_file()

    if not api_id_s or not api_hash:
        fail(out_path, "Set TELEGRAM_API_ID and TELEGRAM_API_HASH in telegram_announcement/.env (my.telegram.org).")
        return

    if not has_file_session and not session_string:
        fail(
            out_path,
            "Set TELEGRAM_STRING_SESSION in .env and/or keep telegram_announcement/broadcast_mtproto.session. "
            "Run once: .venv\\Scripts\\python scripts\\export_string_session.py (login), "
            "paste TELEGRAM_STRING_SESSION into .env, and do not delete broadcast_mtproto.session if you need numeric chat IDs.",
        )
        return

    try:
        api_id = int(api_id_s)
    except ValueError:
        fail(out_path, "TELEGRAM_API_ID must be an integer.")
        return

    chat_ids_in = payload.get("chat_ids") or []
    message = (payload.get("message") or "").strip()
    image_path = payload.get("image_path")

    if not isinstance(chat_ids_in, list) or len(chat_ids_in) == 0:
        fail(out_path, "No chat_ids in payload.")
        return

    bot_tok = (payload.get("guest_bot_token") or os.getenv("TELEGRAM_GUEST_BOT_TOKEN") or "").strip()
    chat_ids = _resolve_chat_ids_via_bot_getchat(chat_ids_in, bot_tok)

    if not message and not image_path:
        fail(out_path, "Need message and/or image_path.")
        return

    if image_path and not Path(image_path).is_file():
        fail(out_path, f"Image file not found: {image_path}")
        return

    errors: list[dict] = []
    success_count = 0

    # session_string → MemoryStorage: peer cache is lost every process exit, so raw numeric IDs often fail
    # unless Telegram already returns the user. broadcast_mtproto.session → FileStorage: peers persist.
    if has_file_session:
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

    await app.start()
    try:
        me = await app.get_me()
        self_id = int(me.id)
        storage_mode = "file session (peer cache persisted)" if has_file_session else "string session only (peers not kept between runs)"
        print(
            f"[pyrogram-broadcast] Session user_id={self_id} "
            f"(username={me.username or 'none'}). Storage: {storage_mode}. "
            f"Smoke test: me on one line. For numeric guest IDs, keep broadcast_mtproto.session after export.",
            file=sys.stderr,
        )

        for raw in chat_ids:
            peer_token = str(raw).strip()
            try:
                if isinstance(raw, bool):
                    raise ValueError("Invalid chat id (boolean).")
                if isinstance(raw, (int, float)):
                    if isinstance(raw, float) and not float(raw).is_integer():
                        raise ValueError("Chat id must be a whole number.")
                    s = str(int(raw))
                else:
                    s = str(raw).strip()
                peer_token = s
                low = s.lower()

                # Dapat User/Chat object o "me" — huwag raw int user id (walang access_hash → PEER_ID_INVALID).
                if low in ("me", "self", "saved", "saved messages"):
                    peer = "me"
                elif s.isdigit() or (s.startswith("-") and len(s) > 1 and s[1:].isdigit()):
                    nid = int(float(s)) if "." in s else int(s)
                    if nid > 0:
                        # Sariling user id bilang integer → PEER_ID_INVALID sa MTProto; Saved Messages = "me".
                        if nid == self_id:
                            print(
                                f"[pyrogram-broadcast] chat id {nid} = session user_id → using Saved Messages (me)",
                                file=sys.stderr,
                            )
                            peer = "me"
                        else:
                            resolved = await app.get_users(nid)
                            peer = _peer_prefer_username(resolved)
                    else:
                        try:
                            resolved = await app.get_chat(nid)
                            peer = _peer_prefer_username(resolved)
                        except Exception:
                            peer = nid
                else:
                    peer = s

                print(
                    f"[pyrogram-broadcast] send raw={raw!r} peer_out={peer!r} peer_type={type(peer).__name__}",
                    file=sys.stderr,
                )

                if image_path:
                    await app.send_photo(peer, image_path, caption=message or None)
                else:
                    await app.send_message(peer, message)

                success_count += 1
            except FloodWait as e:
                errors.append({"chatId": str(raw), "error": f"FloodWait {e.value}s"})
                await asyncio.sleep(min(float(e.value), 60))
            except PeerIdInvalid as e:
                msg = str(e) + _format_peer_invalid_hint(self_id, peer_token, has_file_session)
                errors.append({"chatId": str(raw), "error": msg})
            except (UserIsBlocked, RPCError) as e:
                errors.append({"chatId": str(raw), "error": str(e)})
            except Exception as e:  # noqa: BLE001
                errors.append({"chatId": str(raw), "error": str(e)})

            await asyncio.sleep(0.06)
    finally:
        await app.stop()

    fail_count = len(errors)
    Path(out_path).write_text(
        json.dumps(
            {
                "success": True,
                "successCount": success_count,
                "failCount": fail_count,
                "errors": errors if errors else [],
            }
        ),
        encoding="utf-8",
    )


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: send_broadcast_user.py <input.json> <output.json>", file=sys.stderr)
        sys.exit(2)
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    try:
        payload = json.loads(Path(in_path).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        fail(out_path, f"Invalid input JSON: {e}")
        sys.exit(1)
    asyncio.run(run_broadcast(payload, out_path))


if __name__ == "__main__":
    main()
