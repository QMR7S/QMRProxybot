#!/usr/bin/env python3
"""Stage public static files from the verified owner backup; do not upload them."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import time
import sys
from urllib.error import URLError, HTTPError
import urllib.request
from urllib.parse import quote, urljoin, urlsplit

REPO=Path(__file__).resolve().parents[1]
BASE="https://app9239734904.tgcloud.ai/"
REF=REPO/"handoff/production-v12.5/source/QMRProxy_Termux_Rebuild/site"
EXPECTED=set("""admin/admin.js admin/index.html app.js assets/instagram.svg assets/telegram.svg assets/ui-icons.svg assets/youtube.svg console.css contact/index.html extra-proxies.json extra-v11.css faq/index.html guide/index.html icon-192.png icon-512.png icon.svg index.html manifest.webmanifest mini/index.html mini/mini.css mini/mini.js navigation-v11.js nodes.json official-links.json ops/index.html ops/ops.js privacy/index.html proxy-tools-core.js proxy-tools-ui.js quality-public-v119.json quality-v119.css quality-v119.js refine-v11.css safety/index.html studio-v11.css styles.css sw.js terms/index.html theme-v11.css""".split())
OVERLAYS=("admin/admin.js","admin/index.html","ops/ops.js","ops/index.html")
MAX=8*1024*1024
# Reviewed actual deployed revision-5 sources, owner export 2026-11-27.
# Only exact recognized bytes qualify; unknown modifications still stop staging.
REVIEWED_LIVE={
    "admin/admin.js": "6b2bd6b80e16290bf51d174bce44bf38fdf0f0903ae044c2a022df8cd4c3ebef",
    "admin/index.html": "655724e2e9942a19a2f6f4e00d2a257a4f3ab0ca8f86b98c28c6565c6d378a72",
    "ops/ops.js": "68d1ca28c7662c341b1e3d00fdfb6d7c2387047d35b674f444dbed2c0ce9c8c3",
    "ops/index.html": "4f39411faadb5382cb68595e01521581e11d62de22804dbfcdf0ec2bbf44a053",
    "app.js": "3583bb969aeb48105aecb93f908b339b8a819ae7879208d71b8795b1ec9a24aa",
    "index.html": "4ebb9cba039f9d2bcefddcc71623eedbb3c4b5bd7cad19c27c8d87f07f6653d3",
    "mini/mini.js": "530b70d60cabcff10bf752a3cd04c8dc732dfc175863daf3baab6800ca305278",
    "mini/index.html": "f9c6f9dc8cfc3486588412499e71d43ca50d92c07074b5be156cfc9904f7f676",
    "privacy/index.html": "2bb8f9fa524f33d0c4abde68f91c69833b660dbfa7270058c06acdef873e097e",
    "sw.js": "0d372b4a0b8f9d10b24bbb9de3f2be6be873366f726695dd1097b1105563eee9"
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def verified(backup):
    m=json.loads((backup/"backup-manifest.json").read_text())
    hashes=m.get("sha256")
    if not isinstance(hashes,dict) or set(hashes)!=EXPECTED or m.get("failed")!=[]:
        raise ValueError("39-file backup manifest does not match the recorded inventory")
    for p,h in hashes.items():
        relative=PurePosixPath(p)
        if relative.is_absolute() or ".." in relative.parts or "\\" in p:raise ValueError("unsafe path")
        f=backup/p
        if not f.is_file() or f.is_symlink() or f.resolve()!=f.absolute() or not re.fullmatch(r"[a-f0-9]{64}",h) or digest(f.read_bytes())!=h:
            raise ValueError("backup hash mismatch: "+p)
    return hashes

class StaticRedirect(Exception):
    def __init__(self,location):
        self.location=location
        super().__init__("static redirect")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def python_download(url):
    op=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    req=urllib.request.Request(url,headers={"Cache-Control":"no-cache"})
    try:
        with op.open(req,timeout=15) as r:
            if r.status!=200:raise ValueError("unexpected HTTP status")
            return r.read(MAX+1)
    except HTTPError as exc:
        if exc.code in (301,302,303,307,308):
            raise StaticRedirect(exc.headers.get("Location")) from None
        raise

def curl_download(url):
    # No redirect following, no TLS bypass, no inherited curl config or proxy.
    # The body goes to a private temporary file, not to the terminal.
    with tempfile.TemporaryDirectory(prefix="qmr-https-") as tmp:
        target=Path(tmp)/"body"
        r=subprocess.run(["curl","-q","--silent","--show-error","--noproxy","*",
            "--proto","=https","--connect-timeout","10","--max-time","25",
            "--max-filesize",str(MAX),"--header","Cache-Control: no-cache",
            "--output",str(target),"--write-out","%{http_code}\n%{redirect_url}",url],
            capture_output=True,text=True,timeout=30)
        if r.returncode!=0:raise OSError("curl exit "+str(r.returncode))
        status,_,location=r.stdout.partition("\n")
        if status in ("301","302","303","307","308"):
            raise StaticRedirect(location.strip())
        if status!="200":raise ValueError("unexpected HTTP status: "+status)
        if not target.is_file() or target.stat().st_size>MAX:raise ValueError("invalid body size")
        return target.read_bytes()

def static_paths(p):
    path="/"+quote(p,safe="/")
    if p=="index.html":return {path,"/"}
    if p.endswith("/index.html"):
        directory=path[:-len("index.html")]
        return {path,directory,directory.rstrip("/")}
    return {path}

def redirect_target(current,location,p):
    if not isinstance(location,str) or not location or any(ord(c)<33 or ord(c)==127 for c in location):
        raise ValueError("invalid static redirect: "+p)
    candidate=urljoin(current,location)
    dest=urlsplit(candidate)
    base=urlsplit(BASE)
    if (dest.scheme!=base.scheme or dest.netloc!=base.netloc or
        dest.path not in static_paths(p) or dest.query not in ("","qmr_verify=14") or dest.fragment):
        raise ValueError("unexpected static redirect: "+p)
    return candidate

def download_static(download,url,p):
    seen=set()
    for _ in range(4):
        if url in seen:raise ValueError("static redirect loop: "+p)
        seen.add(url)
        try:return download(url)
        except StaticRedirect as exc:
            url=redirect_target(url,exc.location,p)
    raise ValueError("too many static redirects: "+p)

def remote_digest(p):
    # Directory index files have a canonical public directory URL.
    canonical=p[:-len("index.html")] if p=="index.html" or p.endswith("/index.html") else p
    url=BASE+quote(canonical,safe="/")+"?qmr_verify=14"
    failures=[]
    for attempt in range(2):
        for download in (python_download,curl_download):
            try:
                data=download_static(download,url,p)
                if not data or len(data)>MAX:raise ValueError("invalid body size")
                return digest(data)
            except HTTPError as e:
                if e.code not in (408,429,500,502,503,504):raise ValueError("HTTP "+str(e.code)+": "+p) from None
                failures.append("HTTP "+str(e.code))
            except (OSError,URLError,subprocess.SubprocessError) as e:
                failures.append(type(e).__name__+": "+str(e)[:120])
        if attempt==0:time.sleep(2)
    raise RuntimeError("HTTPS verification unavailable for "+p+"; "+ "; ".join(failures)+
        ". Check Android network/DNS and retry. No deployment authorized.") from None

def check_remote(hashes):
    # Verify a single representative file before starting concurrent requests.
    items=list(hashes.items())
    if not items:raise ValueError("empty manifest")
    p,expected=items[0]
    if remote_digest(p)!=expected:raise ValueError("live static file changed: "+p)
    print("LIVE HTTPS PREFLIGHT PASS",flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for (p,expected),actual in zip(items[1:],pool.map(remote_digest,[p for p,_ in items[1:]])):
            if actual!=expected:raise ValueError("live static file changed: "+p)
    print("LIVE STATIC HASHES MATCH:",len(hashes))

def replace_once(s,old,new,name):
    if s.count(old)!=1:raise ValueError("unexpected source shape: "+name)
    return s.replace(old,new,1)

def make_browser_sources():
    # Build exactly the same validation functions as the native modules, but use
    # browser HTTPS. These modules contain no credentials.
    primary=re.sub(r"(?m)^export ","",(REPO/"tgcloud/lib/nodes.js").read_text())
    extra=re.sub(r"(?m)^export ","",(REPO/"tgcloud/lib/extra_cloud.js").read_text())
    return """(()=>{'use strict';\n"""+primary+"\n"+extra+"""
async function external(url){
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),12000);
 try{
  const r=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:ctrl.signal});
  if(!r.ok)throw Error('HTTP '+r.status);
  const t=await r.text();if(t.length>1100000)throw Error('source too large');
  return {ok:true,text:async()=>t,json:async()=>JSON.parse(t)};
 }finally{clearTimeout(timer);}
}
function jsonResponse(data){return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});}
window.QMRSourceLive=Object.freeze({
 async primary(path){try{const d=await getNodes(external);if(d.from==='remote')return jsonResponse({...d,source_checked_at:d.updated_at});}catch(_){}return fetch(path,{cache:'no-store'});},
 async extra(path){try{const d=await getExtraNodes(external);if(d.from==='remote')return jsonResponse({schema:'qmr-extra-v1',nodes:d.nodes,source_checked_at:d.updated_at,updated_at:d.updated_at});}catch(_){}return fetch(path,{cache:'no-store'});}
});
})();
"""

def stage(backup,target,verify_live=True):
    backup=backup.expanduser().resolve()
    target=target.expanduser().absolute()
    hashes=verified(backup)
    if target.exists() or target.is_symlink():raise ValueError("target exists; nothing overwritten")
    if verify_live:check_remote(hashes)
    # The reviewed export shows old read-only Admin/Ops JS using missing endpoints.
    # Accept only known reference bytes or the exact reviewed production export.
    for p,reviewed in REVIEWED_LIVE.items():
        data=(backup/p).read_bytes()
        if digest(data)!=reviewed and data!=(REF/p).read_bytes():
            raise ValueError("dashboard source diverged from reference or reviewed export: "+p)
    print("SOURCE BASELINE VERIFIED: known reference / reviewed production export",flush=True)
    target.mkdir(mode=0o700,parents=False)
    for p in hashes:
        dest=target/p
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(backup/p,dest)
    for p in OVERLAYS:
        shutil.copy2(REPO/"cloud-overlay"/p,target/p)
    (target/"source-live.js").write_text(make_browser_sources())
    # Preserve every existing layout, storage key, and link; patch only four
    # known data-loading expressions and the script versions.
    for name,prefix in (("app.js","./"),("mini/mini.js","../")):
        f=target/name;s=f.read_text()
        for kind,filename in (("primary","nodes.json"),("extra","extra-proxies.json")):
            old="fetch('"+prefix+filename+"',{cache:'no-store'})"
            new="(window.QMRSourceLive?.{}('{}{}')||{})".format(kind,prefix,filename,old)
            s=replace_once(s,old,new,name)
        s=s.replace(" أو تشغيل ./sync-site.sh في Termux","")
        # A future/invalid source timestamp must never be treated as fresh.
        s=s.replace("(Number.isFinite(age)&&age>36*3600000)","(!Number.isFinite(age)||age<0||age>36*3600000)")
        f.write_text(s)
    for name,prefix,src in (("index.html","./","./app.js?v=123"),("mini/index.html","../","./mini.js?v=123")):
        f=target/name;s=f.read_text()
        # Insert a deferred source adapter before the existing deferred app JS.
        pattern=r'<script\b[^>]*\bsrc="'+re.escape(src)+r'"[^>]*>'
        matches=list(re.finditer(pattern,s))
        if len(matches)!=1:raise ValueError("unexpected script tag: "+name)
        m=matches[0]
        s=s[:m.start()]+'<script defer src="'+prefix+'source-live.js?v=cloud14"></script>'+m.group().replace("v=123","v=cloud14")+s[m.end():]
        f.write_text(s)
    # Disclose direct browser requests to the already attributed public feeds.
    privacy=target/"privacy/index.html"
    s=privacy.read_text()
    if "</body>" not in s:raise ValueError("privacy HTML shape")
    privacy.write_text(s.replace("</body>",'<p class="notice" style="padding:1rem">عند تحديث القوائم يطلب المتصفح بيانات المصدرين العامّين عبر GitHub. قد تستقبل استضافتهما عنوان IP ووقت الطلب؛ لا نرسل معرف Telegram أو بيانات حسابك.</p></body>',1))
    sw=target/"sw.js";s=sw.read_text()
    s,n=re.subn(r"const CACHE='[^']+';","const CACHE='qmr-cloud14-20261127';",s)
    if n!=1:raise ValueError("unknown service worker version")
    s=replace_once(s,"'./app.js?v=123'","'./app.js?v=cloud14','./source-live.js?v=cloud14'","sw")
    s=replace_once(s,"'./mini/mini.js?v=123'","'./mini/mini.js?v=cloud14'","sw")
    sw.write_text(s)
    files={str(f.relative_to(target)):digest(f.read_bytes()) for f in target.rglob("*") if f.is_file()}
    if set(files)!=EXPECTED|{"source-live.js"}:raise ValueError("staged file inventory mismatch")
    (target.parent/"static-release-manifest.json").write_text(json.dumps(files,indent=2))
    print("STATIC STAGE PASS:",len(files),"files; original backup retained")
    return files

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("backup",type=Path);p.add_argument("target",type=Path)
    p.add_argument("--verify-release",action="store_true")
    a=p.parse_args()
    try:
        if a.verify_release:
            manifest=json.loads((a.target.parent/"static-release-manifest.json").read_text())
            check_remote(manifest)
        else:stage(a.backup,a.target)
    except (ValueError,RuntimeError,OSError) as exc:
        print("STOP:",str(exc),file=sys.stderr)
        sys.exit(1)
