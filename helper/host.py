"""Goko Downloader native messaging host (Chrome <-> yt-dlp). Stdlib only."""
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import time

HOST_VERSION = "1.0.0"
IS_WIN = os.name == "nt"
CREATE_NO_WINDOW = 0x08000000 if IS_WIN else 0

if IS_WIN:
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

STDIN = sys.stdin.buffer
STDOUT = sys.stdout.buffer
WRITE_LOCK = threading.Lock()

# ---------------------------------------------------------------- logging
LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "GokoDownloader")
LOG_FILE = os.path.join(LOG_DIR, "host.log")


def log(msg):
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1024 * 1024:
            open(LOG_FILE, "w").close()
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except Exception:
        pass


# ---------------------------------------------------------------- tools
def base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")


def find_tool(name):
    exe = name + (".exe" if IS_WIN else "")
    cands = [base_dir()]
    if os.environ.get("GOKO_VENDOR_DIR"):
        cands.append(os.environ["GOKO_VENDOR_DIR"])
    for d in cands:
        p = os.path.join(d, exe)
        if os.path.isfile(p):
            return p
    return shutil.which(name)


def ffmpeg_dir():
    p = find_tool("ffmpeg")
    return os.path.dirname(p) if p else None


def js_runtime():
    """Returns (name, path): bundled/known deno preferred, then node on PATH, else (None, None)."""
    exe = "deno.exe" if IS_WIN else "deno"
    cands = [base_dir()]
    if os.environ.get("GOKO_VENDOR_DIR"):
        cands.append(os.environ["GOKO_VENDOR_DIR"])
    for d in cands:
        p = os.path.join(d, exe)
        if os.path.isfile(p):
            return "deno", os.path.abspath(p)
    if shutil.which("node"):
        return "node", shutil.which("node")
    return None, None


def default_out_dir():
    return os.path.join(os.path.expanduser("~"), "Downloads", "GokoDownloader")


def child_env():
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    return env


# ---------------------------------------------------------------- io
def send(obj):
    try:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        with WRITE_LOCK:
            STDOUT.write(struct.pack("<I", len(data)))
            STDOUT.write(data)
            STDOUT.flush()
    except Exception as e:
        log("send failed: %r" % e)


def read_message():
    hdr = STDIN.read(4)
    if len(hdr) < 4:
        return None
    (n,) = struct.unpack("<I", hdr)
    body = STDIN.read(n)
    if len(body) < n:
        return None
    return json.loads(body.decode("utf-8"))


# ---------------------------------------------------------------- yt-dlp version
_ver_cache = {"v": None}


def ytdlp_version(refresh=False):
    if _ver_cache["v"] and not refresh:
        return _ver_cache["v"]
    exe = find_tool("yt-dlp")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL,
                           creationflags=CREATE_NO_WINDOW, encoding="utf-8", errors="replace",
                           env=child_env())
        v = (r.stdout or "").strip().splitlines()
        _ver_cache["v"] = v[0] if v else None
    except Exception as e:
        log("version failed: %r" % e)
    return _ver_cache["v"]


# ---------------------------------------------------------------- downloads
DOWNLOADS = {}
DL_LOCK = threading.Lock()


def build_format_args(mode, quality, audio_format):
    if mode == "audio":
        af = audio_format if audio_format in ("mp3", "m4a") else "mp3"
        return ["-f", "ba/b", "-x", "--audio-format", af, "--audio-quality", "0",
                "--embed-thumbnail", "--embed-metadata"]
    q = str(quality or "best")
    if q.isdigit():
        f = ("bv*[height<=%s][ext=mp4]+ba[ext=m4a]/bv*[height<=%s]+ba/b[height<=%s]/b"
             % (q, q, q))
    else:
        f = "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b"
    return ["-f", f, "--merge-output-format", "mp4"]


def num(s):
    try:
        v = float(s)
        return v if v == v else None
    except Exception:
        return None


STATUS_PREFIXES = ("[Merger]", "[ExtractAudio]", "[EmbedThumbnail]", "[FixupM3u8]",
                   "[VideoConvertor]")


def kill_tree(proc):
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                           capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=15)
        else:
            proc.kill()
    except Exception as e:
        log("kill failed: %r" % e)


def run_download(msg):
    did = msg.get("id")
    url = msg.get("url")
    exe = find_tool("yt-dlp")
    out_dir = msg.get("outDir") or default_out_dir()
    st = {"proc": None, "cancelled": False, "out_dir": out_dir}
    with DL_LOCK:
        DOWNLOADS[did] = st
    try:
        if not exe:
            send({"type": "error", "id": did, "message": "yt-dlp.exe bulunamadi."})
            return
        if not url:
            send({"type": "error", "id": did, "message": "URL eksik."})
            return
        try:
            os.makedirs(out_dir, exist_ok=True)
        except Exception as e:
            send({"type": "error", "id": did, "message": "Klasor olusturulamadi: %s" % e})
            return
        template = msg.get("template") or "%(title)s [%(id)s].%(ext)s"
        cmd = [exe, "--newline", "--no-playlist", "--no-colors", "--windows-filenames",
               "-o", template, "-P", out_dir,
               "--progress-template",
               "download:GOKO|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
               "%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
               "--print", "before_dl:GOKOTITLE|%(title)s",
               "--print", "after_move:GOKOFILE|%(filepath)s",
               "--no-simulate", "--no-quiet", "--progress"]  # --print implies --quiet
        fd = ffmpeg_dir()
        if fd:
            cmd += ["--ffmpeg-location", fd]
        jr_name, jr_path = js_runtime()
        if jr_name == "deno":
            cmd += ["--js-runtimes", "deno:%s" % jr_path]
        elif jr_name == "node":
            cmd += ["--js-runtimes", "node"]
        mode = "audio" if msg.get("mode") == "audio" else "video"
        cmd += build_format_args(mode, msg.get("quality"), msg.get("audioFormat"))
        cmd.append(url)
        n_streams = 2 if mode == "video" else 1

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW,
                                encoding="utf-8", errors="replace", env=child_env())
        st["proc"] = proc
        send({"type": "started", "id": did})

        tail = []
        filepath = None
        processing = False
        last_emit = 0.0
        stream_idx = 0
        dest_count = 0
        for raw in proc.stdout:
            line = raw.rstrip("\r\n")
            if not line:
                continue
            if line.startswith("GOKO|"):
                p = line.split("|")
                if len(p) < 6:
                    continue
                dl, tot, est, spd, eta = (num(x) for x in p[1:6])
                total = tot or est
                pct = (dl / total * 100.0) if (dl is not None and total) else 0.0
                pct = max(0.0, min(100.0, pct))
                overall = (stream_idx * 100.0 + pct) / n_streams
                now = time.time()
                if now - last_emit >= 0.25 or pct >= 100:
                    last_emit = now
                    send({"type": "progress", "id": did, "percent": round(overall, 1),
                          "downloaded": dl, "total": total, "speed": spd, "eta": eta})
                continue
            if line.startswith("GOKOTITLE|"):
                send({"type": "title", "id": did, "title": line[len("GOKOTITLE|"):]})
                continue
            if line.startswith("GOKOFILE|"):
                filepath = line[len("GOKOFILE|"):].strip()
                continue
            if line.startswith("[download] Destination:"):
                dest_count += 1
                stream_idx = min(dest_count - 1, n_streams - 1)
            tail.append(line)
            del tail[:-20]
            if not processing and line.startswith(STATUS_PREFIXES):
                processing = True
                send({"type": "status", "id": did, "status": "processing"})
        rc = proc.wait()
        if st["cancelled"]:
            return
        if rc == 0:
            send({"type": "done", "id": did, "filepath": filepath})
        else:
            errs = [x for x in tail if x.startswith("ERROR:")]
            message = errs[-1] if errs else ("\n".join(tail[-5:]) or ("yt-dlp cikis kodu %s" % rc))
            log("download %s failed rc=%s: %s" % (did, rc, "\n".join(tail)))
            send({"type": "error", "id": did, "message": message})
    except Exception as e:
        log("download exception: %r" % e)
        if not st["cancelled"]:
            send({"type": "error", "id": did, "message": str(e)})
    finally:
        with DL_LOCK:
            DOWNLOADS.pop(did, None)


def cleanup_partials(out_dir):
    try:
        for n in os.listdir(out_dir):
            if n.endswith((".part", ".ytdl")) or ".part-" in n:
                try:
                    os.remove(os.path.join(out_dir, n))
                except Exception:
                    pass
    except Exception:
        pass


def do_cancel(did):
    with DL_LOCK:
        st = DOWNLOADS.get(did)
    if st:
        st["cancelled"] = True
        proc = st.get("proc")
        if proc and proc.poll() is None:
            kill_tree(proc)
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
        time.sleep(0.3)
        cleanup_partials(st["out_dir"])
    send({"type": "cancelled", "id": did})


def kill_all():
    with DL_LOCK:
        items = list(DOWNLOADS.values())
    for st in items:
        st["cancelled"] = True
        p = st.get("proc")
        if p and p.poll() is None:
            kill_tree(p)


# ---------------------------------------------------------------- commands
def handle(msg):
    cmd = msg.get("cmd")
    rid = msg.get("reqId")
    if cmd == "ping":
        send({"type": "pong", "reqId": rid, "ok": True, "host_version": HOST_VERSION,
              "ytdlp_version": ytdlp_version(), "ffmpeg_found": bool(find_tool("ffmpeg")),
              "out_dir": default_out_dir(), "js_runtime": js_runtime()[0]})
    elif cmd == "download":
        threading.Thread(target=run_download, args=(msg,), daemon=True).start()
    elif cmd == "cancel":
        threading.Thread(target=do_cancel, args=(msg.get("id"),), daemon=True).start()
    elif cmd == "open_folder":
        path = msg.get("path") or default_out_dir()
        try:
            if os.path.isfile(path):
                subprocess.Popen("explorer /select,\"%s\"" % os.path.normpath(path),
                                 creationflags=CREATE_NO_WINDOW)
            else:
                d = path if os.path.isdir(path) else os.path.dirname(path)
                if not os.path.isdir(d):
                    os.makedirs(d, exist_ok=True)
                os.startfile(d)
            send({"type": "ok", "reqId": rid})
        except Exception as e:
            log("open_folder: %r" % e)
            send({"type": "error", "reqId": rid, "message": str(e)})
    elif cmd == "update":
        exe = find_tool("yt-dlp")
        if not exe:
            send({"type": "update_result", "reqId": rid, "ok": False,
                  "output": "yt-dlp.exe bulunamadi.", "ytdlp_version": None})
            return
        try:
            r = subprocess.run([exe, "-U"], capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL,
                               creationflags=CREATE_NO_WINDOW, encoding="utf-8",
                               errors="replace", env=child_env())
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            send({"type": "update_result", "reqId": rid, "ok": r.returncode == 0, "output": out,
                  "ytdlp_version": ytdlp_version(refresh=True)})
        except Exception as e:
            log("update: %r" % e)
            send({"type": "update_result", "reqId": rid, "ok": False, "output": str(e),
                  "ytdlp_version": ytdlp_version()})
    else:
        send({"type": "error", "reqId": rid, "message": "Bilinmeyen komut: %s" % cmd})


def main():
    try:
        while True:
            msg = read_message()
            if msg is None:
                break
            try:
                if isinstance(msg, dict) and msg.get("cmd") in ("update", "ping"):
                    threading.Thread(target=handle, args=(msg,), daemon=True).start()
                else:
                    handle(msg)
            except Exception as e:
                log("handle error: %r" % e)
                send({"type": "error", "reqId": msg.get("reqId") if isinstance(msg, dict) else None,
                      "message": str(e)})
    except Exception as e:
        log("main loop error: %r" % e)
    finally:
        kill_all()


if __name__ == "__main__":
    main()
