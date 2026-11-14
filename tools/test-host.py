"""Test harness for the native host. Usage:
  py tools/test-host.py
  py tools/test-host.py --download URL [--mode audio] [--quality 360] [--cancel-after N] [--out DIR]
  py tools/test-host.py --exe helper/dist/GokoHost/GokoHost.exe
"""
import argparse
import json
import os
import queue
import struct
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe")
    ap.add_argument("--download")
    ap.add_argument("--mode", default="video")
    ap.add_argument("--quality", default="best")
    ap.add_argument("--audio-format", default="mp3")
    ap.add_argument("--out")
    ap.add_argument("--cancel-after", type=float)
    ap.add_argument("--no-vendor-env", action="store_true", help="do not set GOKO_VENDOR_DIR")
    ap.add_argument("--timeout", type=float, default=180)
    a = ap.parse_args()

    env = dict(os.environ)
    if not a.no_vendor_env:
        env.setdefault("GOKO_VENDOR_DIR", os.path.join(ROOT, "helper", "vendor"))
    else:
        env.pop("GOKO_VENDOR_DIR", None)
    cmd = [os.path.abspath(a.exe)] if a.exe else [sys.executable, "-u", os.path.join(ROOT, "helper", "host.py")]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
    q = queue.Queue()

    def reader():
        try:
            while True:
                h = p.stdout.read(4)
                if len(h) < 4:
                    break
                n = struct.unpack("<I", h)[0]
                q.put(json.loads(p.stdout.read(n).decode("utf-8")))
        finally:
            q.put(None)

    threading.Thread(target=reader, daemon=True).start()

    def send(o):
        d = json.dumps(o).encode("utf-8")
        p.stdin.write(struct.pack("<I", len(d)) + d)
        p.stdin.flush()

    def get(t):
        try:
            return q.get(timeout=t)
        except queue.Empty:
            return "timeout"

    rc = 0
    try:
        send({"cmd": "ping", "reqId": "r1"})
        m = get(20)
        print("PING ->", m)
        if not m or m == "timeout" or m.get("type") != "pong":
            rc = 1
        if a.download:
            req = {"cmd": "download", "id": "t1", "url": a.download, "mode": a.mode,
                   "quality": a.quality, "audioFormat": a.audio_format}
            if a.out:
                req["outDir"] = a.out
            send(req)
            start = time.time()
            cancel_sent = False
            while True:
                if a.cancel_after is not None and not cancel_sent and time.time() - start >= a.cancel_after:
                    send({"cmd": "cancel", "id": "t1"})
                    cancel_sent = True
                    print("-> sent cancel")
                if time.time() - start > a.timeout:
                    print("TIMEOUT")
                    rc = 2
                    break
                m = get(0.5)
                if m == "timeout":
                    continue
                if m is None:
                    print("host closed stdout")
                    rc = 3
                    break
                print(m)
                if m.get("type") in ("done", "error", "cancelled"):
                    if m["type"] == "error":
                        rc = 4
                    if m["type"] == "done":
                        fp = m.get("filepath")
                        print("file exists:", bool(fp and os.path.exists(fp)), fp)
                    break
    finally:
        try:
            p.stdin.close()
        except Exception:
            pass
        try:
            p.wait(timeout=10)
            print("host exited cleanly, code", p.returncode)
        except Exception:
            p.kill()
            print("host had to be killed")
    sys.exit(rc)


if __name__ == "__main__":
    main()
