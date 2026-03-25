#!/bin/bash
# Fires on UserPromptSubmit — records turn start time, scoped to session
hook_data=$(cat)
session_id=$(echo "$hook_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id','unknown'))" 2>/dev/null)
[ -z "$session_id" ] && exit 0

mkdir -p /tmp/claude
python3 -c "import time; print(int(time.time()*1000))" > "/tmp/claude/turn-start-${session_id}.ts"
