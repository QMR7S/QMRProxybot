#!/usr/bin/env bash
# Exact-source guarded, targeted update. Never changes schema or static assets.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(cd "${1:?Existing V14 linked release required}" && pwd)"
OLD=85b7268348f7e8cabdf630b941ef18669d05511a
NEW=d118b8dcb9196fb6f3b01bbf01b93c81b50c53a9
MODE="${2:-deploy}"
case "$MODE" in deploy) FROM=$OLD; TO=$NEW;; rollback) FROM=$NEW; TO=$OLD;; *) exit 2;; esac
R="$(mktemp -d "$HOME/QMRCloud_Stability.XXXXXX")"
echo "RELEASE: $R"
trap 'echo "Release retained: $R"' EXIT
cd "$REPO"
git cat-file -e "$FROM^{commit}";git cat-file -e "$TO^{commit}"
test "$(git rev-parse HEAD:tgcloud)" = "$(git rev-parse "$NEW:tgcloud")" || { echo "STOP: unexpected repository source";exit 1; }
python3 -m unittest discover -s tests -q
npm run test:bot
node --test tests/cloud_boards.test.mjs tests/extra_cloud.test.mjs tests/cloud_boards_sqlite.test.mjs tests/broadcast_control_sqlite.test.mjs
test -d "$BASE/.tgcloud" && test -d "$BASE/cloud-dist" && test -f "$BASE/tgcloud.jsonc"
cp -a "$BASE/.tgcloud" "$BASE/package.json" "$BASE/tgcloud.jsonc" "$BASE/cloud-dist" "$R/"
ln -s "$BASE/node_modules" "$R/node_modules"
cd "$R"
unset TGCLOUD_TOKEN
# Deliberate production inventory, not all review-branch modules.
FILES=(schema.js handlers/message.js handlers/callback_query.js lib/nodes.js lib/store.js lib/ui.js lib/owner_callback_guard.js lib/cloud_boards.js lib/cloud_boards_core.js lib/extra_cloud.js endpoints/qmr_admin.js endpoints/qmr_ops.js lib/broadcast_control.js lib/notification_runtime.js lib/sdk_write_adapter.js)
for f in "${FILES[@]}"; do
 mkdir -p "tgcloud/$(dirname "$f")"
 git -C "$REPO" show "$FROM:tgcloud/$f" > "tgcloud/$f"
done
cp -a tgcloud "$R/baseline-modules"
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
[[ "$STATUS" == *app9239734904* && "$STATUS" == *"Working directory clean."* && "$STATUS" == *"Webhook: in sync"* ]] || { echo "STOP: live baseline differs; nothing deployed";exit 1; }
npx --no-install tgcloud migrate --dry-run | tee "$R/schema-before.log"
grep -q 'No schema changes' "$R/schema-before.log"
npx --no-install tgcloud webhook | tee "$R/webhook-before.log"
grep -Fq 'https://cloud.telegram.org/app9239734904/webhook' "$R/webhook-before.log"
# Check exactly the three changed modules against the selected commit.
for f in handlers/message.js handlers/callback_query.js lib/ui.js; do
 git -C "$REPO" show "$TO:tgcloud/$f" > "tgcloud/$f"
 node --check "tgcloud/$f"
done
# This temporary handler only reads; its contents must never be published.
cp tgcloud/handlers/message.js "$R/message.target.js"
cat > tgcloud/handlers/message.js <<'JS'
import {api,db} from 'sdk';
export default async function(){
 const me=await api.getMe();
 if(me.id!==9239734904||String(me.username).toLowerCase()!=='qmrproxybot')throw Error('wrong bot');
 for(const table of ['qmr_users_v6','qmr_settings_v6','qmr_board_audit_v14','qmr_notify_jobs_v13','qmr_notify_delivery_v13','qmr_notify_optin_v13']){
  const r=await db.get('SELECT COUNT(*) AS n FROM '+table);
  if(!Number.isSafeInteger(r?.n)||r.n<0)throw Error('invalid table read');
 }
 return {stability_probe:true};
}
JS
if ! npx --no-install tgcloud run handlers/message '{}' > "$R/read-probe.log" 2>&1; then
 cp "$R/message.target.js" tgcloud/handlers/message.js
 cat "$R/read-probe.log";exit 1
fi
cp "$R/message.target.js" tgcloud/handlers/message.js
grep -Eq 'stability_probe:[[:space:]]*true|"stability_probe":[[:space:]]*true' "$R/read-probe.log"
echo "LIVE READ-ONLY PROBE: PASS"
npx --no-install tgcloud run handlers/message '{}'
npx --no-install tgcloud status
# Selective push only; no full mirror, no schema, no static files.
npx --no-install tgcloud push lib/ui handlers/message handlers/callback_query
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
[[ "$STATUS" == *"Working directory clean."* && "$STATUS" == *"Webhook: in sync"* ]]
npx --no-install tgcloud webhook | tee "$R/webhook-after.log"
grep -Fq 'https://cloud.telegram.org/app9239734904/webhook' "$R/webhook-after.log"
npx --no-install tgcloud migrate --dry-run | tee "$R/schema-after.log"
grep -q 'No schema changes' "$R/schema-after.log"
echo "STABILITY $MODE: PASS"
echo "No schema migration, static upload or test messages performed."
