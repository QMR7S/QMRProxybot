#!/usr/bin/env bash
# Original TGCloud application only. No full push, no credentials output,
# no live notifications during this script. Abort on unexpected cloud state.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(cd "${1:?V14.1 linked release directory required}" && pwd)"
STABLE=a852004630ac55d4fbed3e6dcef085a6fb653424
R="$(mktemp -d "$HOME/QMRCloud_Notifications.XXXXXX")"
echo "RELEASE: $R"
trap 'echo "Release and private backup retained: $R"' EXIT
cd "$REPO"
git cat-file -e "$STABLE^{commit}"
node --test tests/broadcast_control_sqlite.test.mjs tests/cloud_boards_sqlite.test.mjs tests/cloud_boards.test.mjs
npm run test:bot
test -d "$BASE/.tgcloud" && test -d "$BASE/cloud-dist" && test -f "$BASE/tgcloud.jsonc"
cp -a "$BASE/.tgcloud" "$BASE/tgcloud" "$BASE/package.json" "$BASE/tgcloud.jsonc" "$BASE/cloud-dist" "$R/"
ln -s "$BASE/node_modules" "$R/node_modules"
cd "$R"
unset TGCLOUD_TOKEN
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
[[ "$STATUS" == *app9239734904* && "$STATUS" == *"Working directory clean."* && "$STATUS" == *"Webhook: in sync"* ]] || { echo "STOP: unexpected baseline state"; exit 1; }
npx --no-install tgcloud migrate --dry-run | tee "$R/baseline-schema.txt"
grep -q "No schema changes" "$R/baseline-schema.txt"
# Verify every live module matches the prior reviewed V14.1 commit, not just
# a revision number. The review repository also has undeployed candidates.
mapfile -t EXPECTED < <(printf '%s\n' schema.js handlers/message.js handlers/callback_query.js lib/nodes.js lib/store.js lib/ui.js lib/owner_callback_guard.js lib/cloud_boards.js lib/cloud_boards_core.js lib/extra_cloud.js endpoints/qmr_admin.js endpoints/qmr_ops.js | sort)
mapfile -t ACTUAL < <(cd tgcloud && find . -type f -name '*.js' | sed 's@^\./@@' | sort)
[[ "${EXPECTED[*]}" == "${ACTUAL[*]}" ]] || { echo "STOP: unexpected module inventory"; exit 1; }
for f in "${EXPECTED[@]}"; do
 git -C "$REPO" show "$STABLE:tgcloud/$f" | cmp - "tgcloud/$f" || { echo "STOP: changed baseline module $f"; exit 1; }
done
# Read-only export into local private storage; never publish or paste this file.
# Preserve the original handler even if the SDK command fails.
cp tgcloud/handlers/message.js "$R/message.baseline.js"
cat > tgcloud/handlers/message.js <<'JS'
import {api,db} from 'sdk';
export default async function(){
 const me=await api.getMe();
 if(me.id!==9239734904)throw Error('wrong bot');
 const result={};
 for(const name of ['qmr_users_v6','qmr_settings_v6','qmr_broadcasts_v6','qmr_board_audit_v14'])
   result[name]=await db.all('SELECT * FROM '+name);
 console.log('QMR_PRIVATE_EXPORT='+JSON.stringify(result));
 return {ok:true};
}
JS
if ! npx --no-install tgcloud run handlers/message '{}' > "$R/private-db-export.log" 2>&1; then
 cp "$R/message.baseline.js" tgcloud/handlers/message.js
 echo "STOP: private export failed";exit 1
fi
cp "$R/message.baseline.js" tgcloud/handlers/message.js
python3 - "$R" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
raw=(p/"private-db-export.log").read_text()
mark="QMR_PRIVATE_EXPORT="
if raw.count(mark)!=1:raise SystemExit("STOP: private DB export not verified")
data,_=json.JSONDecoder().raw_decode(raw.split(mark,1)[1])
expected={"qmr_users_v6","qmr_settings_v6","qmr_broadcasts_v6","qmr_board_audit_v14"}
if set(data)!=expected or any(not isinstance(x,list) for x in data.values()):raise SystemExit("STOP: invalid export")
(p/"database-v14.1.private.json").write_text(json.dumps(data,ensure_ascii=False,indent=2))
for k,v in data.items():print(k,len(v))
if data["qmr_broadcasts_v6"]:raise SystemExit("STOP: legacy broadcast records require explicit mapping")
print("PRIVATE DATABASE BACKUP: PASS")
PY
for f in schema.js lib/broadcast_control.js lib/notification_runtime.js lib/cloud_boards_core.js handlers/message.js handlers/callback_query.js; do
 cp "$REPO/tgcloud/$f" "tgcloud/$f"
 node --check "tgcloud/$f"
done
# Empty update performs no DB writes or sends, but checks native module loading.
npx --no-install tgcloud run handlers/message '{}'
echo "=== REVIEW ADDITIVE SCHEMA ==="
npx --no-install tgcloud migrate --local --dry-run | tee "$R/schema-preview.txt"
for table in qmr_notify_optin_v13 qmr_notify_jobs_v13 qmr_notify_delivery_v13; do
 grep -q "$table" "$R/schema-preview.txt" || { echo "STOP: expected table missing";exit 1; }
done
echo "Only the three qmr_notify_* tables and their indexes may be added."
echo "If any other change is present, do not approve."
read -r -p "Type ADD_NOTIFICATION_TABLES to continue: " ANSWER
[[ "$ANSWER" == "ADD_NOTIFICATION_TABLES" ]] || exit 1
npx --no-install tgcloud push schema
npx --no-install tgcloud migrate --safe
npx --no-install tgcloud migrate --dry-run | tee "$R/schema-after.txt"
grep -q "No schema changes" "$R/schema-after.txt"
# Verify the real SDK's no-row UPDATE RETURNING, raw run and all methods.
# This intentionally changes no records and sends no Telegram messages.
cp tgcloud/handlers/message.js "$R/message.candidate.js"
cat > tgcloud/handlers/message.js <<'JS'
import {db,api} from 'sdk';
export default async function(){
 const me=await api.getMe();
 if(me.id!==9239734904)throw Error('wrong bot');
 for(const t of ['qmr_notify_optin_v13','qmr_notify_jobs_v13','qmr_notify_delivery_v13']){
  const r=await db.get('SELECT COUNT(*) AS n FROM '+t);
  if(r.n!==0)throw Error('notification tables not empty');
 }
 const none=await db.get('UPDATE qmr_notify_jobs_v13 SET step_seq=step_seq WHERE 0 RETURNING id');
 if(none!=null)throw Error('unexpected update result');
 await db.run('UPDATE qmr_notify_delivery_v13 SET state=state WHERE 0');
 return {native_sql_preflight:true};
}
JS
if ! npx --no-install tgcloud run handlers/message '{}' > "$R/native-sql-preflight.log" 2>&1; then
 cp "$R/message.candidate.js" tgcloud/handlers/message.js
 echo "STOP: native SQL probe failed";exit 1
fi
cp "$R/message.candidate.js" tgcloud/handlers/message.js
grep -Eq 'native_sql_preflight:[[:space:]]*true|"native_sql_preflight":[[:space:]]*true' "$R/native-sql-preflight.log"
echo "NATIVE SQL PREFLIGHT: PASS"
npx --no-install tgcloud status
# Explicit module list, never a full mirror and no static changes.
npx --no-install tgcloud push lib/broadcast_control lib/notification_runtime lib/cloud_boards_core handlers/message handlers/callback_query
npx --no-install tgcloud fetch
npx --no-install tgcloud status
npx --no-install tgcloud webhook
npx --no-install tgcloud migrate --dry-run
echo "NOTIFICATION CODE DEPLOYED. No recipients were contacted."
echo "Run /broadcast_test followed by a short test message in the owner's private bot chat."
echo "Confirm the draft, then press send once. Opt-in campaigns unlock only when canary delivery is confirmed."
