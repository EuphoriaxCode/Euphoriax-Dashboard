# Build machine worker

`worker.mjs` runs on the PC that has UEFN + the `unreal-mcp` server. It turns the dashboard's **Build queue** into work:

1. Every 20 s it asks the dashboard for the next prompt (`/api/machine/claim`).
2. It runs the prompt with **Claude Code** in headless mode (`claude -p`), using whatever account `claude` is logged into,
   so it runs on your Claude subscription. It adds a preamble telling Claude to follow
   [UEFN-MCP-Guidelines/MCP_RULES.md](https://github.com/EuphoriaxCode/UEFN-MCP-Guidelines).
3. It streams the log back to the dashboard live. Pressing **Cancel** on the dashboard stops the run.
4. When it finishes, the dashboard marks the job done or failed and pings Discord (`NOTIFY_DISCORD_WEBHOOK`).
5. If Claude hits the subscription usage limit, the job goes back to the front of the queue and the worker waits
   `LIMIT_WAIT_MINUTES` (default 30) before it tries again. Leave the PC on and it keeps working through the queue.

It sends a heartbeat every minute, so the dashboard shows the machine as online, building or offline.
If the machine goes offline while it is building, the job is put back in the queue automatically.

## Setup (Windows)

```powershell
# once: install Node 20+ and Claude Code, then log in
npm install -g @anthropic-ai/claude-code
claude            # log in with your Claude account, check the unreal MCP server is connected, then exit

# every time (or as a scheduled task at login)
$env:DASHBOARD_URL = "https://euphoriax.net/dashboard"
$env:MACHINE_KEY   = "<same as MACHINE_KEY on the server>"
$env:MACHINE_NAME  = "build-pc"
$env:WORK_DIR      = "C:\UEFN\Euphoriax"     # folder Claude starts in (the one with your MCP config)
node worker.mjs
```

| Env | Default | |
|---|---|---|
| `CLAUDE_BIN` | `claude` | path to the Claude Code CLI |
| `CLAUDE_ARGS` | `--dangerously-skip-permissions` | Unattended runs can't approve tool prompts, so by default Claude may use **any** tool on this PC. Only run trusted prompts. To limit it, use for example `--permission-mode acceptEdits --allowedTools mcp__unreal` |
| `POLL_SECONDS` | `20` | how often to check the queue when idle |
| `LIMIT_WAIT_MINUTES` | `30` | pause after hitting the Claude usage limit |
| `PROMPT_PREAMBLE` | (MCP rules preamble) | text put in front of every prompt |
