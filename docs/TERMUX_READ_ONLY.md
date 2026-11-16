# Read-only Termux verification for @QMRProxybot

**No production changes are performed by these commands.** They do not publish to Telegram or change the existing webhook. Use the owner's own Android/Termux terminal and keep credentials private.

## 1. Inspect the staged source
```bash
pkg update
pkg install -y git nodejs-lts python
git clone --branch review/qmr-proxy-v2-safe-integration https://github.com/QMR7S/QMRProxybot.git
cd QMRProxybot
python3 -m unittest discover -s tests -v
npm run test:syntax
```
Private GitHub clone requires your authenticated GitHub credentials. Do not paste passwords or PATs into chat.

## 2. Read existing Telegram Serverless state

First, confirm **@QMRProxybot** in BotFather → Serverless → CLI Access and obtain a CLI Access token. This is **not** the normal Bot API token.

```bash
npm install
npx tgcloud login
npx tgcloud fetch
npx tgcloud status
npx tgcloud diff
npx tgcloud webhook
```

`fetch` checks cloud deployment without rewriting local code. `webhook` (without `sync`) inspects the webhook, not repairs it. `status` and `diff` are local comparisons after `fetch`. These operations can reveal existing handler behavior, not prove the real-world proxy works.

**IMPORTANT:** Do **not** run `npx tgcloud push`, `pull`, `reset`, `migrate`, `webhook sync`, or `--force` at this stage. Do not start a long-polling bot on this identity.

Share only sanitized findings: whether webhook is present, whether modules exist, their filenames, whether the serverless project matches the target bot, and whether there are conflicting modules. **Never** share token strings, full webhook URLs with secrets, private source containing credentials, or user data.

## 3. Website and proxy node release gates

- GitHub repository is private. Pages requires an appropriate GitHub plan for private repositories. Alternatively host a separate **public sanitized** site or use independent static hosting without making the private source repository public.
- The draft PR can be reviewed without merging or publishing. The Pages workflow is manual only.
- A real public TCP VPS node must exist, with valid MTProto FakeTLS configuration. GitHub, Telegram Serverless and Termux alone cannot provide a reliable 24/7 public TCP listener.
- Check connectivity from Iraqi mobile data and different fixed-line ISPs before announcing availability; measure actual latency and success rates.
- Only later merge, deploy the static site, and deploy Serverless code after a live diff and restore plan.

**Completed now:** GitHub source staged safely in draft PR; no Telegram deployment or webhook changes.
