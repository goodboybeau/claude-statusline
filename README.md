# claude-statusline

A multi-line statusline for [Claude Code](https://claude.ai/code) with gradual-fill progress bars, real-time rate limits, and per-turn timing stats.

![screenshot](screenshot.png)

## What it shows

**Line 1:** Model name, session cost, output tokens, directory (branch), session duration, thinking effort

**Stacked bars:**
| Row | Description |
|-----|-------------|
| `context` | Context window usage with token counts |
| `current` | 5-hour rate limit with reset time |
| `weekly` | 7-day rate limit with reset date |
| `turns` | Per-turn wall-clock timing: last, avg, p50, max, count |

Progress bars use gradual-fill dots (`○ ◔ ◑ ◕ ●`) and color-code from green to red as usage increases.

Turn timing captures full wall-clock time per turn (thinking + tool calls + subagents), not just API latency.

## Install

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI
- `jq` (`brew install jq` on macOS)
- `python3` (for timestamps and turn stats — ships with macOS)
- `curl` and `git`

### Setup

```bash
# Copy scripts
cp statusline.sh ~/.claude/statusline.sh
mkdir -p ~/.claude/scripts
cp turn-timing-start.sh ~/.claude/scripts/turn-timing-start.sh
cp turn-timing-stop.sh ~/.claude/scripts/turn-timing-stop.sh
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

Restart Claude Code.

## How turn timing works

Two hooks capture wall-clock time per turn:

1. **`UserPromptSubmit`** records a millisecond timestamp when you press enter
2. **`Stop`** fires when Claude finishes, computes the delta, and appends to a per-session history file (`/tmp/claude/turns-{session_id}.log`)

The statusline reads the history and computes last/avg/p50/max stats. History is per-session and resets on restart.

## Base

Built on top of [kamranahmedse/claude-statusline](https://github.com/kamranahmedse/claude-statusline) with the following additions:

- Gradual-fill progress dots (`◔ ◑ ◕ ●`)
- Context window bar stacked above rate limit bars
- Session cost and output tokens on line 1 (replacing redundant context %)
- Per-turn wall-clock timing via `UserPromptSubmit` / `Stop` hooks

## License

MIT
