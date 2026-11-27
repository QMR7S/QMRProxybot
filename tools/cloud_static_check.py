#!/usr/bin/env python3
"""Public static-content check: no credentials, no writes, no raw response output."""
import hashlib
import json
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request

BASE = "https://app9239734904.tgcloud.ai"
HTML = ("/", "/mini/", "/admin/", "/ops/")
JSON = ("/nodes.json", "/extra-proxies.json")
LIMIT = 2 * 1024 * 1024

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def classify(route, body):
    if route in JSON:
        try:
            obj=json.loads(body)
        except (ValueError,UnicodeError):
            return "INVALID_JSON", None
        if not isinstance(obj,dict) or not isinstance(obj.get("nodes"),list):
            return "INVALID_INVENTORY", None
        count=len(obj["nodes"])
        return ("JSON_OK" if count else "EMPTY_INVENTORY"), count
    return ("HTML_OK" if b"<html" in body.lower() else "NOT_HTML"), None

def main():
    opener=build_opener(ProxyHandler({}),NoRedirect())
    hashes={}
    for route in HTML+JSON:
        try:
            with opener.open(Request(BASE+route,headers={"Cache-Control":"no-cache"}),timeout=15) as res:
                body=res.read(LIMIT+1)
                if res.status!=200 or len(body)>LIMIT:
                    raise ValueError("unexpected response")
            kind,count=classify(route,body)
            digest=hashlib.sha256(body).hexdigest()[:16]
            print(route,kind,"count="+str(count) if count is not None else "", "hash="+digest)
            if route in HTML:
                hashes[route]=digest
        except Exception as e:
            print(route,"FAILED",type(e).__name__)
    for route in HTML[1:]:
        if route in hashes and hashes.get("/") == hashes[route]:
            print(route,"SAME_AS_ROOT: possible SPA fallback; verify rendered route")

if __name__=="__main__":
    main()
