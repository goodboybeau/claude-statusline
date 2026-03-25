#!/bin/bash
# Fires on Stop — computes turn duration and appends to per-session history
hook_data=$(cat)
session_id=$(echo "$hook_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id','unknown'))" 2>/dev/null)
[ -z "$session_id" ] && exit 0

start_file="/tmp/claude/turn-start-${session_id}.ts"
history_file="/tmp/claude/turns-${session_id}.log"

[ ! -f "$start_file" ] && exit 0

start_ms=$(cat "$start_file")
end_ms=$(python3 -c "import time; print(int(time.time()*1000))")
duration_ms=$(( end_ms - start_ms ))

[ "$duration_ms" -le 0 ] && exit 0

mkdir -p /tmp/claude
echo "$duration_ms" >> "$history_file"

# Keep last 100 turns
python3 -c "
lines = open('$history_file').readlines()
if len(lines) > 100:
    open('$history_file', 'w').writelines(lines[-100:])
" 2>/dev/null

rm -f "$start_file"
