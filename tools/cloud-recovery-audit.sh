#!/usr/bin/env bash
# Read-only cloud inventory. Use the already linked checkout as the sole argument.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINKED="$(cd "${1:?Usage: bash cloud-recovery-audit.sh /path/to/linked-project}" && pwd)"
cd "$LINKED"
test -d .tgcloud && test -d node_modules && test -d tgcloud || { echo "STOP: expected linked project with local CLI"; exit 1; }
unset TGCLOUD_TOKEN
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
[[ "$STATUS" == *app9239734904* ]] || { echo "STOP: wrong app"; exit 1; }
OUT="$(mktemp -d "$HOME/QMRCloud_Inventory.XXXXXX")"
TMP="$(mktemp -d "$HOME/.qmr-cloud-private.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT
cp -a tgcloud .tgcloud package.json "$TMP/"
ln -s "$LINKED/node_modules" "$TMP/node_modules"
cd "$TMP"
printf '%s\n' "$STATUS" > "$OUT/status.txt"
echo "=== DEPLOYED MODULE BACKUP ==="
# pull affects ONLY this disposable private checkout; never pushes.
npx --no-install tgcloud pull
npx --no-install tgcloud status
cp -a tgcloud "$OUT/deployed-modules"
find "$OUT/deployed-modules" -type f -name '*.js' -exec node --check {} \;
find "$OUT/deployed-modules" -type f -name '*.js' | sed "s|$OUT/deployed-modules/||" | sort
echo "=== CLOUD IDENTITY AND DATABASE COUNTS ==="
cat > tgcloud/handlers/message.js <<'JS'
import { api, db } from 'sdk';
import { qmrUsers, qmrSettings, qmrBroadcasts } from 'schema';
export default async function () {
  const result = {};
  try {
    const me=await api.getMe();
    result.identity={ok:me.id===9239734904 && String(me.username).toLowerCase()==='qmrproxybot',id:me.id};
  } catch(e) { result.identity={ok:false,code:e.code??null}; }
  for(const [name,table] of [['users',qmrUsers],['settings',qmrSettings],['broadcasts',qmrBroadcasts]]) {
    try {
      const count=await db.$count(table);
      result[name]={ok:true,count};
    } catch(e) { result[name]={ok:false,code:e.code??null}; }
  }
  console.log(JSON.stringify(result));
  return result;
}
JS
# Only a count of rows, no private user records, settings values or message bodies.
if ! npx --no-install tgcloud run handlers/message '{}' | tee "$OUT/counts.txt"; then
  echo "SDK run failed; source backup preserved"
fi
echo "=== STATIC CONTENT CHECK ==="
python3 "$HERE/cloud_static_check.py" | tee "$OUT/static-summary.txt"
echo "PRIVATE SOURCE SNAPSHOT: $OUT"
echo "No push, migrate, reset, webhook change or cloud DB writes were performed."
