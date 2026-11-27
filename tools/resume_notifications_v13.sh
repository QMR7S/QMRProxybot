#!/usr/bin/env bash
# Resume after the three tables were already migrated. Never push schema or static.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD="$(cd "${1:?previous failed release directory required}" && pwd)"
STABLE=a852004630ac55d4fbed3e6dcef085a6fb653424
SCHEMA=a953405cd98e3c717c8f166b5a4c71499f2fa4ea
R="$(mktemp -d "$HOME/QMRCloud_Notifications_Resume.XXXXXX")"
echo "RELEASE: $R"
trap 'echo "Release retained: $R"' EXIT
cd "$REPO"
node --test tests/broadcast_control_sqlite.test.mjs tests/cloud_boards_sqlite.test.mjs tests/cloud_boards.test.mjs
npm run test:bot
test -s "$OLD/database-v14.1.private.json"
test -d "$OLD/.tgcloud" && test -d "$OLD/cloud-dist" && test -f "$OLD/tgcloud.jsonc"
cp -a "$OLD/.tgcloud" "$OLD/package.json" "$OLD/tgcloud.jsonc" "$OLD/cloud-dist" "$R/"
ln -s "$OLD/node_modules" "$R/node_modules"
cp "$OLD/database-v14.1.private.json" "$R/"
cd "$R"
unset TGCLOUD_TOKEN
# Reconstruct the exact deployed baseline: V14.1 modules, plus the schema
# deployed in the previous attempt. Do not copy undeployed candidate modules.
for f in handlers/message.js handlers/callback_query.js lib/nodes.js lib/store.js lib/ui.js lib/owner_callback_guard.js lib/cloud_boards.js lib/cloud_boards_core.js lib/extra_cloud.js endpoints/qmr_admin.js endpoints/qmr_ops.js; do
 mkdir -p "tgcloud/$(dirname "$f")"
 git -C "$REPO" show "$STABLE:tgcloud/$f" > "tgcloud/$f"
done
git -C "$REPO" show "$SCHEMA:tgcloud/schema.js" > tgcloud/schema.js
npx --no-install tgcloud fetch
STATUS="$(npx --no-install tgcloud status)"
printf '%s\n' "$STATUS"
[[ "$STATUS" == *app9239734904* && "$STATUS" == *"Working directory clean."* && "$STATUS" == *"Webhook: in sync"* ]] || { echo "STOP: unexpected deployed baseline"; exit 1; }
npx --no-install tgcloud migrate --dry-run | tee "$R/schema-check.log"
grep -q "No schema changes" "$R/schema-check.log"
cmp "$REPO/tgcloud/schema.js" tgcloud/schema.js || { echo "STOP: schema has changed";exit 1; }
for f in lib/broadcast_control.js lib/sdk_write_adapter.js lib/notification_runtime.js lib/cloud_boards_core.js lib/cloud_boards.js handlers/message.js handlers/callback_query.js; do
 cp "$REPO/tgcloud/$f" "tgcloud/$f"
 node --check "tgcloud/$f"
done
echo "=== LIVE SDK PROBE (SIMULATED DELIVERY ONLY) ==="
cp tgcloud/handlers/message.js "$R/message.candidate.js"
cp "$REPO/tools/native_notification_probe.mjs" tgcloud/handlers/message.js
if ! npx --no-install tgcloud run handlers/message '{}' > "$R/native-sql-preflight.log" 2>&1; then
 cp "$R/message.candidate.js" tgcloud/handlers/message.js
 cat "$R/native-sql-preflight.log"
 echo "STOP: SDK probe failed; no modules published";exit 1
fi
cp "$R/message.candidate.js" tgcloud/handlers/message.js
cat "$R/native-sql-preflight.log"
grep -Eq 'native_sql_preflight:[[:space:]]*true|"native_sql_preflight":[[:space:]]*true' "$R/native-sql-preflight.log"
grep -Eq 'cleanup:[[:space:]]*true|"cleanup":[[:space:]]*true' "$R/native-sql-preflight.log"
echo "NATIVE SDK WRITE AND CLEANUP: PASS"
npx --no-install tgcloud run handlers/message '{}'
npx --no-install tgcloud status
# Targeted atomic push, no full mirror, no migration, no static upload.
npx --no-install tgcloud push lib/sdk_write_adapter lib/broadcast_control lib/notification_runtime lib/cloud_boards_core lib/cloud_boards handlers/message handlers/callback_query
npx --no-install tgcloud fetch
npx --no-install tgcloud status
npx --no-install tgcloud webhook
npx --no-install tgcloud migrate --dry-run
echo "NOTIFICATION CODE DEPLOYED. Actual delivery still requires owner-only canary."
