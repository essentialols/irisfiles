#!/bin/bash
# patrol.sh - Automated code patrol for IrisFiles
# Uses Claude Code CLI (Max subscription) to find and fix bugs.
# Creates PRs on GitHub for each fix.
#
# Usage:
#   bash patrol.sh              # Full patrol: triage + fix + PR
#   bash patrol.sh --dry-run    # Triage only, no fixes
#   bash patrol.sh --cleanup    # Delete local+remote patrol/* branches, close PRs
#
# Triggers:
#   - Daily via launchd (com.irisfiles.patrol.plist)
#   - On push via .git/hooks/post-push

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Allow running from inside a Claude Code session
unset CLAUDECODE 2>/dev/null || true

# Lock file to prevent concurrent patrols
LOCKFILE="$PROJECT_DIR/.patrol/.lock"
mkdir -p .patrol
if [[ -f "$LOCKFILE" ]]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Patrol already running (PID $LOCK_PID). Exiting."
    exit 0
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# --- Args ---
DRY_RUN=false
CLEANUP=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --cleanup) CLEANUP=true ;;
  esac
done

# --- Cleanup mode ---
if [[ "$CLEANUP" == true ]]; then
  echo "Cleaning up patrol branches and PRs..."
  # Close open patrol PRs
  gh pr list --label "patrol" --state open --json number --jq '.[].number' 2>/dev/null | \
    while read -r pr; do
      echo "Closing PR #$pr"
      gh pr close "$pr" 2>/dev/null || true
    done
  # Delete remote patrol branches
  git branch -r --list 'origin/patrol/*' | sed 's|origin/||' | \
    while read -r branch; do
      echo "Deleting remote $branch"
      git push origin --delete "$branch" 2>/dev/null || true
    done
  # Delete local patrol branches
  git branch --list 'patrol/*' | xargs git branch -D 2>/dev/null || true
  echo "Done."
  exit 0
fi

# --- Preflight ---
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "ERROR: Must be on main (currently on $BRANCH)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree dirty. Commit or stash first."
  exit 1
fi

# Pull latest before patrolling
git pull --ff-only origin main 2>/dev/null || true

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG=".patrol/patrol-$TIMESTAMP.log"

echo "=== IrisFiles Patrol $TIMESTAMP ===" | tee "$LOG"
echo "Project: $PROJECT_DIR" | tee -a "$LOG"

# --- Phase 1: Triage with haiku (cheap, read-only) ---
echo "" | tee -a "$LOG"
echo "Phase 1: Triage (haiku, read-only)..." | tee -a "$LOG"

TRIAGE_PROMPT="You are a code patrol bot. Your working directory is $PROJECT_DIR.
Read PATROL.md for your instructions.

Scan ONLY the files listed under \"Priority files\" in PATROL.md.
Read each file and look for bugs, error handling gaps, and edge cases.
Check the \"Known fragile areas\" section for where to look hardest.

Output ONLY a JSON array, no markdown fences, no explanation:
[{\"file\": \"js/example.js\", \"line\": 42, \"severity\": \"high\", \"description\": \"what is wrong\", \"fix\": \"how to fix it\"}]

If no issues, output: []

Rules:
- Only flag things in the \"Fix autonomously\" category
- Do not flag anything in \"Flag only\" or \"Never touch\"
- Be specific about the line and the actual bug
- severity: \"high\" = will cause runtime error, \"medium\" = edge case failure, \"low\" = minor issue"

TRIAGE=$(claude --print \
  --model haiku \
  --dangerously-skip-permissions \
  --allowedTools "Read Glob Grep" \
  -p "$TRIAGE_PROMPT" 2>>"$LOG") || {
  echo "ERROR: Triage failed (see $LOG for details)" | tee -a "$LOG"
  exit 1
}

echo "$TRIAGE" | tee -a "$LOG"

# Extract JSON (handle possible markdown fences)
ISSUES=$(echo "$TRIAGE" | python3 -c "
import sys, json, re
text = sys.stdin.read()
match = re.search(r'\[[\s\S]*\]', text)
if match:
    try:
        arr = json.loads(match.group())
        print(json.dumps(arr))
    except json.JSONDecodeError:
        print('[]')
else:
    print('[]')
" 2>/dev/null) || ISSUES="[]"

COUNT=$(echo "$ISSUES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "" | tee -a "$LOG"
echo "Found $COUNT issue(s)." | tee -a "$LOG"

if [[ "$COUNT" == "0" ]]; then
  echo "Clean patrol. Nothing to fix." | tee -a "$LOG"
  exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. Issues saved to $LOG" | tee -a "$LOG"
  exit 0
fi

# --- Phase 2: Fix each issue on its own branch, push, create PR ---
echo "" | tee -a "$LOG"
echo "Phase 2: Fixing issues..." | tee -a "$LOG"

# Write issues to temp file to avoid pipeline subshell
ISSUES_FILE=$(mktemp)
echo "$ISSUES" | python3 -c "
import sys, json
for i, issue in enumerate(json.load(sys.stdin)):
    print(f\"{i}|{issue['file']}|{issue['severity']}|{issue['description']}|{issue.get('fix','')}\")" > "$ISSUES_FILE"

FIXED=0
SKIPPED=0

while IFS='|' read -r idx file severity desc fix; do
  FIX_BRANCH="patrol/${TIMESTAMP}-${idx}"

  echo "" | tee -a "$LOG"
  echo "--- Fix $idx ($severity): $desc ---" | tee -a "$LOG"
  echo "File: $file | Branch: $FIX_BRANCH" | tee -a "$LOG"

  git checkout -b "$FIX_BRANCH" main

  FIX_PROMPT="You are a code patrol bot for IrisFiles. Your working directory is $PROJECT_DIR.
Read PATROL.md first for guidelines.

Fix this specific issue:
- File: $file
- Problem: $desc
- Suggested approach: $fix

Steps:
1. Read the file and understand the surrounding code
2. Make the MINIMAL change to fix the issue
3. Do not modify any other files or refactor nearby code
4. After editing, run the validation: node test/validate.mjs
5. If validation fails, undo your change (git checkout -- .) and output VALIDATION_FAILED
6. If validation passes, output VALIDATION_PASSED"

  FIX_OUTPUT=$(claude --print \
    --dangerously-skip-permissions \
    --allowedTools "Read Glob Grep Edit Bash" \
    -p "$FIX_PROMPT" 2>>"$LOG") || true

  echo "$FIX_OUTPUT" | tail -5 | tee -a "$LOG"

  # Check if there are actual changes to commit
  if [[ -n "$(git status --porcelain)" ]]; then
    # Double-check validation ourselves
    if node test/validate.mjs > /dev/null 2>&1; then
      git add -A
      git commit -m "patrol: $desc" --no-verify

      # Push branch and create PR
      git push -u origin "$FIX_BRANCH" 2>>"$LOG"
      PR_URL=$(gh pr create \
        --base main \
        --head "$FIX_BRANCH" \
        --title "patrol: $desc" \
        --label "patrol" \
        --body "$(cat <<PREOF
**Severity:** $severity
**File:** \`$file\`

**Problem:** $desc

**Fix:** $fix

---
*Automated patrol fix. Validation passed (all tests green).*
PREOF
)" 2>>"$LOG") || true

      if [[ -n "$PR_URL" ]]; then
        echo "PR created: $PR_URL" | tee -a "$LOG"
      else
        echo "COMMITTED + PUSHED on $FIX_BRANCH (PR creation failed, review manually)" | tee -a "$LOG"
      fi
      FIXED=$((FIXED + 1))
    else
      echo "SKIPPED: validation failed after fix" | tee -a "$LOG"
      git checkout -- .
      git checkout main
      git branch -D "$FIX_BRANCH" 2>/dev/null || true
      SKIPPED=$((SKIPPED + 1))
      continue
    fi
  else
    echo "SKIPPED: no changes made" | tee -a "$LOG"
    git checkout main
    git branch -D "$FIX_BRANCH" 2>/dev/null || true
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  git checkout main
done < "$ISSUES_FILE"

rm -f "$ISSUES_FILE"

echo "" | tee -a "$LOG"
echo "=== Patrol complete: $FIXED fixed, $SKIPPED skipped ===" | tee -a "$LOG"
echo "Full log: $LOG" | tee -a "$LOG"
