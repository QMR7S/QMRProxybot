# V14.2 stability-only patch (27 Nov 2026)
Preserve existing TGCloud operation, static hosting, schema, notification dispatcher, Bot API token and webhook. User confirmed notification rollout success; actual revision number is not assumed.
Changes: nonowner DB failure fails closed rather than bypassing block checks; primary command maintenance check now matches callbacks and extra command; callbacks restricted to matching private chat; admin screen does not show "maintenance off" or offer a toggle when state is unavailable; whitespace command arguments accepted; opt-in help and privacy copy updated.
No changes to local Termux services, public site, MTProto probe/quality or outbound broadcast mechanism.
Candidate needs exact deployed source comparison, read-only SDK preflight and targeted push. Never rerun earlier migration scripts. Live proof requires owner deployment output and Telegram interaction; GitHub CI alone does not establish production success.

## Deploy or rollback
Use the existing linked directory: `bash tools/deploy_stability_v14_2.sh "$HOME/QMRCloud_V14.07AVpc"`. The script reconstructs precisely the known post-notification production modules, validates clean cloud state and schema, runs local tests and a live read-only probe, then pushes only three modules. A divergent baseline stops rather than overwrites. For rollback after a completed deployment, same command with final argument `rollback`. Preserve the existing Termux services and static files. Production rollback also requires the exact deployed candidate baseline, not a force push.
