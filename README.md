# claude-statusline

Your Claude Code dashboard, right in the terminal. Track every token, every dollar, and every rate limit reset — all without leaving your editor.

![statusline](images/statusline.png)

## Why this exists

Claude Code's built-in statusline tells you almost nothing. You're flying blind on your plan with no idea how close you are to a rate limit, how much context you've burned, or how long your turns actually take.

**claude-statusline fixes that.** One glance gives you everything: real-time 5-hour and 7-day rate limit utilization pulled directly from the Anthropic API, context window burn rate, session cost, turn-by-turn performance stats, and countdowns to your next rate limit reset.

Stop guessing. Start monitoring.

## What you get

**Line 1** — the essentials at a glance:

Model name, session cost, output tokens, directory + git branch, session duration, thinking effort level

**Stacked bars** — the stuff Anthropic doesn't surface:

| Row | What it tracks |
|-----|----------------|
| `context` | Context window usage with token counts — know when autocompact is coming |
| `current` | 5-hour rolling rate limit with countdown to reset |
| `weekly` | 7-day rate limit with reset date + time |
| `extra` | Extra usage spend tracking (if enabled on your plan) |
| `turns` | Per-turn wall-clock timing: count, last + completion time, avg, p50, max |

Progress bars use gradual-fill dots (`○ ◔ ◑ ◕ ●`) that color-shift from green to red as usage climbs. You'll know you're in trouble before Anthropic cuts you off.

Turn timing captures **full wall-clock time** per turn — thinking, tool calls, subagent orchestration, everything. Not just API latency.

## Choose your flavor

Two implementations, identical output — pick what fits your stack:

| | [`ts/`](ts/) | [`sh/`](sh/) |
|---|---|---|
| **Files** | 1 (`statusline.ts`) | 3 (`statusline.sh` + 2 hook scripts) |
| **Runtime** | Node.js + `tsx` | Bash + `jq` + `python3` + `curl` |
| **Deps** | `npx tsx` | `brew install jq` (rest ships with macOS) |

---

## TypeScript setup

Single file handles statusline + hooks via CLI args. Zero config beyond copy-paste.

```bash
cp ts/statusline.ts ~/.claude/statusline.ts
chmod +x ~/.claude/statusline.ts
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx \"$HOME/.claude/statusline.ts\" start",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx \"$HOME/.claude/statusline.ts\" stop",
            "timeout": 5
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "npx tsx \"$HOME/.claude/statusline.ts\" statusline"
  }
}
```

---

## Shell setup

Three scripts — statusline + two hook scripts for turn timing.

### Prerequisites

- `jq` (`brew install jq` on macOS)
- `python3` (ships with macOS)
- `curl` and `git`

```bash
cp sh/statusline.sh ~/.claude/statusline.sh
mkdir -p ~/.claude/scripts
cp sh/turn-timing-start.sh ~/.claude/scripts/turn-timing-start.sh
cp sh/turn-timing-stop.sh ~/.claude/scripts/turn-timing-stop.sh
chmod +x ~/.claude/statusline.sh ~/.claude/scripts/turn-timing-*.sh
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$HOME/.claude/scripts/turn-timing-start.sh\"",
            "timeout": 2
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$HOME/.claude/scripts/turn-timing-stop.sh\"",
            "timeout": 2
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/.claude/statusline.sh\""
  }
}
```

---

## How turn timing works

Two hooks capture wall-clock time per turn:

1. **`UserPromptSubmit`** records a millisecond timestamp when you press enter
2. **`Stop`** fires when Claude finishes, computes the delta, and appends to a per-session history file (`/tmp/claude/turns-{session_id}.log`)

The statusline reads the history and computes last/avg/p50/max stats with the timestamp of the last completion. History is per-session and resets on restart.

## How rate limit tracking works

The statusline fetches your current utilization from the Anthropic OAuth usage API using your existing Claude Code credentials (macOS Keychain or `~/.claude/.credentials.json`). Results are cached for 60 seconds to stay lightweight. No API keys to configure — if you're logged into Claude Code, it just works.

## Base

The shell version is built on top of [kamranahmedse/claude-statusline](https://github.com/kamranahmedse/claude-statusline). The TypeScript version is a clean rewrite with identical output.

Additions over the original:

- Gradual-fill progress dots (`◔ ◑ ◕ ●`) with color-coded thresholds
- Context window bar stacked above rate limit bars
- 5-hour and 7-day rate limit utilization from the Anthropic API
- Relative countdown to next rate limit reset
- Session cost and output tokens on line 1
- Per-turn wall-clock timing with completion timestamps via hooks
- Extra usage spend tracking

## License

MIT
