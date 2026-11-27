# Stable HTTPS recovery candidate
This is an alternate route if the existing Telegram-managed SDK remains unauthorized. It retains the full verified Python runtime, rather than replacing it with a partial native bot. It needs a Linux host with persistent storage, outbound Telegram and proxy connectivity, and a DNS name pointing to that host; no host is provisioned or charged by this repository.

## Prepare on a separate Linux host
Install Python 3, cryptography, tmux and Caddy using the host package manager. Clone this branch. Use a dedicated account; do not run the receiver as root.
Replace bot.example.com with the approved stable public hostname:

    python3 tools/stable_runtime.py prepare "$HOME/qmr-stable" bot.example.com

The original 50-file manifest is verified before copying. The staged monitor allowlist is pinned to the exact approved hostname, not any arbitrary URL; original reference files are untouched. The staged guardian manifest is recalculated. Caddyfile terminates HTTPS and forwards only to loopback. Provision Caddy separately with the generated file, correct DNS, and firewall access for TCP 80/443.

## Migrate and activate
1. Keep the old runtime and the existing SQLite backups. Do not delete the webhook. Disable old guardian automatic recovery and gracefully stop the old receiver ONLY at an approved cutover. Confirm there are no in-flight old SQLite updates; take a final consistent backup and transfer it privately using authenticated encrypted transport. Old and new worker processes must never act on the same queued work concurrently.
2. On the new host: 
       python3 tools/stable_runtime.py restore-db "$HOME/qmr-stable" /private/final-backup.sqlite3
   Never copy a live SQLite file with WAL sidecars. Keep backup and existing cloud database separately.
3. Enter the existing token only in the local private prompt:
       cd "$HOME/qmr-stable/QMRProxy_Termux_Rebuild"
       python3 qmr.py configure
       python3 qmr.py refresh-source
       python3 -c 'import qmr; print(qmr.refresh_extra_source())'
   No token in Git, command line or shared logs.
4. Use a dedicated host with no other QMR tmux sessions. Set HOME to the staged root for all four Python services, as their reference paths depend on HOME:
       export HOME="$HOME/qmr-stable"
       cd "$HOME/QMRProxy_Termux_Rebuild"
       tmux new-session -d -s qmrproxy 'python3 webhook.py serve >> logs/bot.log 2>&1'
   The receiver binds loopback and does not auto-register a webhook. Configure HTTPS reverse proxy using the prepared Caddyfile. Do not expose port 8765 publicly.
5. From the cloned repository (absolute path), run:
       python3 tools/stable_runtime.py check /absolute/path/to/qmr-stable
       python3 tools/stable_runtime.py activate /absolute/path/to/qmr-stable
   Both require real TLS, no redirect, matching installation ID, repeated health checks, valid source JSON and denied anonymous dashboard APIs. Activation requires typed confirmation, snapshots the existing webhook and DB, checks the old destination again and retains pending updates.
6. Start the remaining services in the same dedicated host environment with HOME set to the staged root:
       cd "$HOME/QMRProxy_v12_3_Smart_Interface"
       tmux new-session -d -s qmr-health-v117 'python3 monitor.py watch'
       cd "$HOME/QMRProxy_v12_1_Unified_Quality"
       tmux new-session -d -s qmr-quality-v121 'python3 unified.py watch --interval 300 --limit 6'
       cd "$HOME/QMRProxy_v12_4_Stability_Guardian"
       tmux new-session -d -s qmr-guardian-v124 'python3 guardian.py watch --recover-missing --notify-owner'
   Verify live logs and guardian issues, then configure host-specific boot-time supervision. Do not use the legacy tunnel-v10.py repair command on a stable host.
7. Confirm actual fresh /start, /servers, /extra, /best, /quality replies, authenticated Admin/Ops, Mini App content, fresh quality and no queue failures. Old inline buttons may still contain prior URLs; issue /start again. If cutover fails, stop new worker before restoring old receiver; reconcile DB changes and use a reviewed old target/secret without discarding pending updates.

## Limits
Offline tests cover staging, hash checks, host restrictions and fail-closed preflight behavior. They are not evidence of live HTTPS, server provisioning, database transfer or Telegram reply success. This route does not repair the native provider's SDK 401 or enable broadcast v13. No migration of deleted history is possible without a separate backup.
