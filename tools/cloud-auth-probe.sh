#!/usr/bin/env bash
# Read-only remote SDK identity probe. Never pushes, syncs, or modifies DB.
set -euo pipefail
umask 077
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -d .tgcloud || { echo "STOP: link this checkout through tgcloud login"; exit 1; }
npx --no-install tgcloud fetch
status="$(npx --no-install tgcloud status)"
printf '%s\n' "$status"
[[ "$status" == *app9239734904* ]] || { echo "STOP: wrong app"; exit 1; }
tmp="$(mktemp -d "$HOME/qmr-cloud-probe.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
# Separate working copy so an interrupted run cannot overwrite the original handler.
cp -a tgcloud .tgcloud package.json "$tmp/"
ln -s "$PWD/node_modules" "$tmp/node_modules"
cd "$tmp"
cat > tgcloud/handlers/message.js <<'JS'
import { api } from 'sdk';
export default async function () {
  try {
    const me=await api.getMe();
    return {ok:me.id===9239734904 && String(me.username).toLowerCase()==='qmrproxybot',id:me.id,username:me.username};
  } catch(e) {
    return {ok:false,code:e.code??null,error:String(e.description||e.message).slice(0,120)};
  }
}
JS
npx --no-install tgcloud run handlers/message '{}'
