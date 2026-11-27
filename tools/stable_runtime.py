#!/usr/bin/env python3
"""Stage a verified portable QMR runtime and cut over to an explicitly pinned HTTPS host.
No token or database is copied by prepare. No operation changes the live webhook
except activate after a successful preflight, confirmation and snapshot.
"""
import argparse
import contextlib
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import sqlite3
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request

BASE = Path(__file__).resolve().parents[1] / "handoff/production-v12.5"
BOT = "QMRProxy_Termux_Rebuild"
HEALTH = "QMRProxy_v12_3_Smart_Interface"
QUALITY = "QMRProxy_v12_1_Unified_Quality"
GUARDIAN = "QMRProxy_v12_4_Stability_Guardian"
MONITORS = [HEALTH+"/base_monitor.py", QUALITY+"/health_lab.py", GUARDIAN+"/base_monitor.py"]
TABLES = {"meta", "users", "broadcasts", "deliveries", "processed_actions", "webhook_updates"}
HOST_PATTERN = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
BOT_ID = 9239734904
ROUTES = ("/", "/mini/", "/admin/", "/ops/", "/nodes.json", "/extra-proxies.json")

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_host(host):
    if not isinstance(host, str) or host != host.lower() or len(host) > 253:
        raise ValueError("use a lowercase public DNS hostname")
    labels = host.split(".")
    if len(labels)<2 or not all(re.fullmatch(HOST_PATTERN,x) for x in labels):
        raise ValueError("invalid hostname")
    if not labels[-1].isalpha() and not labels[-1].startswith("xn--"):
        raise ValueError("invalid top-level domain")
    if host.endswith((".local",".localhost",".internal",".test",".invalid",".trycloudflare.com")):
        raise ValueError("a stable public DNS hostname is required")
    return host

def public_dns(host):
    addresses = {entry[4][0] for entry in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("target must resolve exclusively to global addresses")

def verify_source(base=BASE):
    manifest = json.loads((base/"manifest.json").read_text())
    if not isinstance(manifest,dict) or len(manifest)!=50:
        raise ValueError("unexpected baseline manifest")
    source=(base/"source").resolve()
    for name,expected in manifest.items():
        relative=PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name:
            raise ValueError("unsafe source path")
        p=source.joinpath(*relative.parts)
        if p.resolve()!=p or not p.is_file() or digest(p)!=expected:
            raise ValueError("source verification failed: "+name)
    return manifest

def replace_once(text,old,new):
    if text.count(old)!=1:
        raise ValueError("unexpected source shape; refusing blind patch")
    return text.replace(old,new,1)

def patch_monitor(text,host):
    old=r"not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com',host or '')"
    text=replace_once(text,old,"host != "+repr(host))
    return text.replace("unexpected or non-Quick-Tunnel host; manual verification required",
                        "unexpected stable host; manual verification required")

def prepare(target,host,base=BASE):
    host=validate_host(host)
    manifest=verify_source(base)
    target=target.expanduser().absolute()
    if target.exists() or target.is_symlink():
        raise ValueError("target already exists; no files overwritten")
    target.mkdir(mode=0o700,parents=False)
    for name in manifest:
        out=target/name
        out.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(base/"source"/name,out)
    for name in MONITORS:
        p=target/name
        p.write_text(patch_monitor(p.read_text(),host))
    # The guardian does not require a cloudflared session on direct HTTPS hosting.
    p=target/GUARDIAN/"guardian.py"
    source=p.read_text()
    source=replace_once(source,"for name in (BOT,HEALTH,QUALITY,TUNNEL):","for name in (BOT,HEALTH,QUALITY):")
    source=replace_once(source,"for s in (BOT,HEALTH,QUALITY,TUNNEL)","for s in (BOT,HEALTH,QUALITY)")
    p.write_text(source)
    guard=target/GUARDIAN/"manifest.json"
    hashes=json.loads(guard.read_text())
    for name in hashes:
        hashes[name]=digest(target/name)
    guard.write_text(json.dumps(hashes,indent=2)+"\n")
    for p in (target/BOT/"data",target/BOT/"logs",target/BOT/"backups",target/BOT/".secrets"):
        p.mkdir(mode=0o700,exist_ok=True)
    (target/"stable-host.json").write_text(json.dumps({"host":host,"bot_id":BOT_ID})+"\n")
    (target/"Caddyfile").write_text(host+" {\n    reverse_proxy 127.0.0.1:8765\n}\n")
    final={name:digest(target/name) for name in manifest}
    (target/"staged-manifest.json").write_text(json.dumps(final,indent=2)+"\n")
    for name in final:
        if name.endswith(".py"):
            compile((target/name).read_bytes(),name,"exec")
    print("STAGE PASS:",len(final),"files; no token, database or production writes")
    return target

def restore_db(target,backup):
    root=target/BOT
    dest=root/"data/qmr.sqlite3"
    backup=backup.expanduser().resolve(strict=True)
    if dest.exists() or dest.is_symlink():
        raise ValueError("destination database exists")
    if not backup.is_file() or any(Path(str(backup)+s).exists() for s in ("-wal","-shm","-journal")):
        raise ValueError("expected standalone consistent SQLite backup")
    with contextlib.closing(sqlite3.connect(backup.as_uri()+"?mode=ro",uri=True)) as src:
        if src.execute("PRAGMA integrity_check").fetchall()!=[("ok",)]:
            raise ValueError("backup integrity failure")
        tables={r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not TABLES<=tables:
            raise ValueError("backup schema mismatch")
        if src.execute("SELECT count(*) FROM webhook_updates WHERE status IN ('pending','processing')").fetchone()[0]:
            raise ValueError("source has in-flight updates; quiesce old receiver and take a fresh backup")
        fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        os.close(fd)
        with contextlib.closing(sqlite3.connect(dest)) as dst:
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchall()!=[("ok",)]:
                raise ValueError("restored database integrity failure")
    print("DATABASE RESTORE PASS")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def request(url,method="GET",body=None,headers=None):
    opener=build_opener(ProxyHandler({}),NoRedirect())
    req=Request(url,data=body,headers=headers or {},method=method)
    try:
        with opener.open(req,timeout=12) as res:
            return res.status,res.read(1024*1024+1)
    except HTTPError as e:
        with e:
            return e.code,e.read(4096)

def identity(url):
    status,body=request(url+"/healthz")
    if status!=200:
        raise ValueError("health HTTP "+str(status))
    d=json.loads(body)
    if (d.get("service"),d.get("version"),d.get("mode"),d.get("ready"))!=("qmrproxy","v10-separated-20261120","webhook",True):
        raise ValueError("unexpected receiver identity/readiness")
    ident=d.get("installation_id")
    if not isinstance(ident,str) or len(ident)<30:
        raise ValueError("missing installation identity")
    return ident

def preflight(host,samples=12,interval=5):
    host=validate_host(host)
    public_dns(host)
    base="https://"+host
    local="http://127.0.0.1:8765"
    for i in range(samples):
        if identity(local)!=identity(base):
            raise ValueError("local/public receiver mismatch")
        status,body=request(base+"/telegram-webhook","POST",b'{"update_id":1}',
                            {"Content-Type":"application/json","X-Telegram-Bot-Api-Secret-Token":"qmr-preflight-invalid"})
        if status!=403 or json.loads(body)!={"error":"forbidden"}:
            raise ValueError("webhook protection/route failed")
        print("HEALTH PASS",i+1,"/",samples,flush=True)
        if i+1<samples:
            time.sleep(interval)
    for route in ROUTES:
        status,body=request(base+route)
        if status!=200 or not body:
            raise ValueError("route failed: "+route)
        if route.endswith(".json"):
            data=json.loads(body)
            if not isinstance(data,dict) or not isinstance(data.get("nodes"),list) or not data["nodes"]:
                raise ValueError("invalid source inventory: "+route)
        elif b"<html" not in body.lower():
            raise ValueError("expected HTML: "+route)
    for route in ("/api/admin/summary","/api/ops/overview"):
        status,_=request(base+route)
        if status!=401:
            raise ValueError("unauthenticated dashboard access not rejected")
    print("PUBLIC PREFLIGHT PASS")
    return base

def target_host(target):
    obj=json.loads((target/"stable-host.json").read_text())
    if obj.get("bot_id")!=BOT_ID:
        raise ValueError("wrong target bot")
    return validate_host(obj["host"])

def activate(target):
    host=target_host(target)
    root=target/BOT
    sys.path.insert(0,str(root))
    import qmr
    import webhook
    api=qmr.Telegram(qmr.load_token())
    me=qmr.check_bot(api)
    if me.get("username","").lower()!="qmrproxybot":
        raise ValueError("wrong bot username")
    old=api.call("getWebhookInfo").get("url","")
    base=preflight(host)
    dest=base+"/telegram-webhook"
    if input("Type ACTIVATE_QMR_STABLE after old receiver is quiesced: ").strip()!="ACTIVATE_QMR_STABLE":
        raise ValueError("cancelled; webhook unchanged")
    preflight(host,samples=2,interval=2)
    if api.call("getWebhookInfo").get("url","")!=old:
        raise ValueError("webhook changed during preflight")
    webhook.snapshot(api)
    secret=webhook.private_value(webhook.SECRET_FILE,create=False)
    if not api.call("setWebhook",url=dest,secret_token=secret,max_connections=4,
                    allowed_updates=["message","callback_query"],drop_pending_updates=False):
        raise ValueError("setWebhook rejected")
    if api.call("getWebhookInfo").get("url")!=dest:
        raise ValueError("Telegram did not confirm target")
    with contextlib.closing(qmr.connect_db()) as cx:
        qmr.setmeta(cx,"site_url",base)
        qmr.setmeta(cx,"webhook_active_url",dest)
    print("WEBHOOK REGISTERED: pending updates retained; verify actual Telegram replies")

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="action",required=True)
    stage=sub.add_parser("prepare"); stage.add_argument("target",type=Path); stage.add_argument("host")
    db=sub.add_parser("restore-db"); db.add_argument("target",type=Path); db.add_argument("backup",type=Path)
    for name in ("check","activate"):
        p=sub.add_parser(name); p.add_argument("target",type=Path)
    a=parser.parse_args()
    if a.action=="prepare":
        prepare(a.target,a.host)
    elif a.action=="restore-db":
        target_host(a.target)
        restore_db(a.target,a.backup)
    elif a.action=="check":
        preflight(target_host(a.target))
    else:
        activate(a.target)

if __name__=="__main__":
    try:
        main()
    except Exception as e:
        # Never print arbitrary exceptions that could contain a credential URL.
        if isinstance(e,ValueError):
            print("STOP:",str(e)[:200],file=sys.stderr)
        else:
            print("STOP:",type(e).__name__,file=sys.stderr)
        sys.exit(1)
