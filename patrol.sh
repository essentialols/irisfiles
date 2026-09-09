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
#   - On push via .git/hooks/pre-push

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Allow running from inside a Claude Code session
unset CLAUDECODE 2>/dev/null || true

# --- Models ---
# Triage (find the bugs) runs on GPT-6 Astra in the native Codex runtime.
# Fixing and test-writing run on Claude Sonnet 5 in the Claude Code runtime.
# Override either from the environment to A/B a different pairing.
TRIAGE_MODEL="${PATROL_TRIAGE_MODEL:-gpt-6-astra}"
TRIAGE_RUNNER="${PATROL_TRIAGE_RUNNER:-$HOME/.claude/bin/codex-native-worker}"
FIX_MODEL="${PATROL_FIX_MODEL:-claude-sonnet-5}"

# --- Behavioural gate ---
# Each fix is checked against a baseline of origin/main rather than against a
# green suite. Gating on "all green" deadlocks: the suite carries long-standing
# failures, so no fix could ever pass and the only agent able to repair the
# tests would be blocked by them.
PW_WORKERS="${PATROL_TEST_WORKERS:-4}"
# Each run reviews by hand, so cap the batch rather than emitting fixes all night.
MAX_FIXES="${PATROL_MAX_FIXES:-5}"
BASELINE_FILE="$PROJECT_DIR/.patrol/baseline-failures.txt"

# Print "file::title" for every failing test. Playwright nests specs inside
# describe blocks, so this recurses; a flat one-level walk finds nothing and
# reads as a clean run.
pw_failures() {
  local dir="$1"
  local json port
  json=$(mktemp)
  # 7100-7899 only: Chromium refuses a list of ports with ERR_UNSAFE_PORT
  # (4045, 5060, 6000, 6665-6669 among others), and landing on one would fail
  # every test and read as a regression.
  port=$(( 7100 + RANDOM % 800 ))
  (cd "$dir" && IRIS_TEST_PORT="$port" IRIS_TEST_NO_REUSE=1 IRIS_TEST_WORKERS="$PW_WORKERS" \
    IRIS_TEST_RETRIES=0 npx playwright test --reporter=json > "$json" 2>/dev/null) || true
  python3 - "$json" <<'PYEOF'
import json, sys
try:
    report = json.load(open(sys.argv[1]))
except Exception:
    print("PW_REPORT_UNREADABLE")
    sys.exit(0)
failures = []
def walk(node, path=None):
    path = node.get("file", path)
    for spec in node.get("specs", []):
        for test in spec.get("tests", []):
            if test.get("status") == "unexpected":
                failures.append("%s::%s" % (path, spec.get("title")))
    for child in node.get("suites", []):
        walk(child, path)
for suite in report.get("suites", []):
    walk(suite)
# Print nothing when clean: a blank line would become a phantom entry in the
# baseline diff below.
if failures:
    print("\n".join(sorted(set(failures))))
PYEOF
  rm -f "$json"
}

if [[ ! -x "$TRIAGE_RUNNER" ]]; then
  echo "ERROR: triage runner not executable: $TRIAGE_RUNNER"
  echo "Set PATROL_TRIAGE_RUNNER, or patrol cannot triage."
  exit 1
fi

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
  # Clean up worktree directory
  rm -rf .patrol/worktree
  echo "Done."
  exit 0
fi

# --- Preflight ---
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "ERROR: Must be on main (currently on $BRANCH)"
  exit 1
fi

# Only check for dirty tree if not triggered by pre-push hook
# (pre-push runs before push completes, tree may have just-committed changes)
if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: Working tree has uncommitted changes. Patrol will use worktrees to avoid interference."
fi

# Fetch before patrolling. Fix branches are cut from origin/main, not local main:
# a silently-failed pull used to leave local main stale, so patrol kept
# rediscovering and re-filing bugs that were already fixed upstream.
if ! git fetch origin main; then
  echo "ERROR: could not fetch origin/main. Refusing to patrol against a stale base."
  exit 1
fi
# Triage (Phase 1) reads this checkout, not a worktree, so local main must be current too.
if ! git merge --ff-only origin/main; then
  echo "ERROR: local main cannot fast-forward to origin/main. Refusing to patrol against a stale base."
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG=".patrol/patrol-$TIMESTAMP.log"

echo "=== IrisFiles Patrol $TIMESTAMP ===" | tee "$LOG"
echo "Project: $PROJECT_DIR" | tee -a "$LOG"

# --- Phase 1: Triage (read-only) ---
echo "" | tee -a "$LOG"
echo "Phase 1: Triage ($TRIAGE_MODEL via codex runtime, read-only)..." | tee -a "$LOG"

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

# Triage runs on GPT-6 Astra in the native Codex runtime. Finding a real bug
# across these files is the step that most rewards model capability, so it does
# not run on the cheapest model. read-only sandbox: triage must not edit.
TRIAGE=$("$TRIAGE_RUNNER" \
  --task "$TRIAGE_PROMPT" \
  --cwd "$PROJECT_DIR" \
  --model "$TRIAGE_MODEL" \
  --sandbox read-only 2>>"$LOG") || {
  echo "ERROR: Triage failed (see $LOG for details)" | tee -a "$LOG"
  exit 1
}

echo "$TRIAGE" | tee -a "$LOG"

# Extract JSON. A first-bracket-to-last-bracket regex cannot be used: runners
# print bracketed log lines like '[worker] run ...' before the answer, and a
# greedy span starting there never parses, which silently reports zero issues.
# Decode at every '[' instead and keep the last well-formed findings array.
ISSUES=$(echo "$TRIAGE" | python3 -c "
import sys, json
text = sys.stdin.read()
dec = json.JSONDecoder()
best = []
for i, ch in enumerate(text):
    if ch != '[':
        continue
    try:
        val, _ = dec.raw_decode(text[i:])
    except ValueError:
        continue
    if not isinstance(val, list):
        continue
    if not all(isinstance(x, dict) and 'file' in x for x in val):
        continue
    if len(val) >= len(best):
        best = val
print(json.dumps(best))
" 2>/dev/null) || ISSUES="[]"

COUNT=$(echo "$ISSUES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "" | tee -a "$LOG"
echo "Found $COUNT issue(s)." | tee -a "$LOG"

if [[ "$COUNT" == "0" ]]; then
  echo "Clean patrol. No code bugs to fix." | tee -a "$LOG"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. Issues saved to $LOG" | tee -a "$LOG"
  exit 0
fi

# --- Phase 2: Fix each issue in an isolated worktree (skip if 0 issues) ---
FIXED=0
SKIPPED=0
WORKTREE_DIR="$PROJECT_DIR/.patrol/worktree"

if [[ "$COUNT" != "0" ]]; then
echo "" | tee -a "$LOG"
echo "Phase 2: Fixing issues ($FIX_MODEL, isolated worktrees)..." | tee -a "$LOG"

# Baseline: which tests does origin/main already fail? Measured once per run,
# in a pristine worktree, so a fix is judged against main and not against a
# green suite that has never existed here.
BASELINE_WORKTREE="$PROJECT_DIR/.patrol/baseline-worktree"
echo "Measuring baseline failures on origin/main..." | tee -a "$LOG"
rm -rf "$BASELINE_WORKTREE" 2>/dev/null || true
git worktree add --detach "$BASELINE_WORKTREE" origin/main 2>>"$LOG"
pw_failures "$BASELINE_WORKTREE" | sort -u > "$BASELINE_FILE"
git worktree remove --force "$BASELINE_WORKTREE" 2>>"$LOG" || true
if grep -q "PW_REPORT_UNREADABLE" "$BASELINE_FILE"; then
  echo "ERROR: could not measure a baseline; refusing to gate fixes blind." | tee -a "$LOG"
  exit 1
fi
echo "Baseline: $(wc -l < "$BASELINE_FILE" | tr -d ' ') failing test(s) on origin/main." | tee -a "$LOG"

# Write issues to temp file to avoid pipeline subshell
ISSUES_FILE=$(mktemp)
echo "$ISSUES" | python3 -c "
import sys, json
for i, issue in enumerate(json.load(sys.stdin)):
    print(f\"{i}|{issue['file']}|{issue['severity']}|{issue['description']}|{issue.get('fix','')}\")" > "$ISSUES_FILE"

while IFS='|' read -r idx file severity desc fix; do
  if [[ "$FIXED" -ge "$MAX_FIXES" ]]; then
    echo "Reached PATROL_MAX_FIXES=$MAX_FIXES; remaining issues stay in $LOG." | tee -a "$LOG"
    break
  fi
  FIX_BRANCH="patrol/${TIMESTAMP}-${idx}"

  echo "" | tee -a "$LOG"
  echo "--- Fix $idx ($severity): $desc ---" | tee -a "$LOG"
  echo "File: $file | Branch: $FIX_BRANCH" | tee -a "$LOG"

  # Create an isolated worktree so we never touch the main working tree
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
  git branch -D "$FIX_BRANCH" 2>/dev/null || true
  git worktree add -b "$FIX_BRANCH" "$WORKTREE_DIR" origin/main 2>>"$LOG"

  FIX_PROMPT="You are a code patrol bot for IrisFiles. Your working directory is $WORKTREE_DIR.
Read PATROL.md first for guidelines.

Fix this specific issue:
- File: $file
- Problem: $desc
- Suggested approach: $fix

Steps:
1. Read the file and understand the surrounding code
2. Make the MINIMAL change to fix the issue
3. Do not modify any other files or refactor nearby code
4. After editing, run the validation: cd $WORKTREE_DIR && node test/validate.mjs
5. If validation fails, undo your change (git checkout -- .) and output VALIDATION_FAILED
6. If validation passes, output VALIDATION_PASSED"

  FIX_OUTPUT=$(claude --print \
    --model "$FIX_MODEL" \
    --dangerously-skip-permissions \
    --allowedTools "Read Glob Grep Edit Bash" \
    -p "$FIX_PROMPT" 2>>"$LOG") || true

  echo "$FIX_OUTPUT" | tail -5 | tee -a "$LOG"

  # Check if there are actual changes to commit (in the worktree)
  if [[ -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]]; then
    # Double-check validation ourselves. validate.mjs only inspects page
    # structure, so it cannot see a behavioural regression; the e2e gate below
    # is what actually exercises the change.
    if (cd "$WORKTREE_DIR" && node test/validate.mjs > /dev/null 2>&1); then

      # Behavioural gate: run the suite against THIS fix, in ITS worktree,
      # before anything is pushed, and reject any test that main was passing.
      echo "  Gate: running e2e against the fix..." | tee -a "$LOG"
      CANDIDATE_FAILURES=$(pw_failures "$WORKTREE_DIR")
      if echo "$CANDIDATE_FAILURES" | grep -q "PW_REPORT_UNREADABLE"; then
        echo "  REJECTED: e2e report unreadable, cannot verify this fix." | tee -a "$LOG"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      NEW_FAILURES=$(comm -13 "$BASELINE_FILE" <(echo "$CANDIDATE_FAILURES" | sed '/^$/d' | sort -u))
      if [[ -n "$NEW_FAILURES" ]]; then
        echo "  REJECTED: introduces $(echo "$NEW_FAILURES" | wc -l | tr -d ' ') new test failure(s):" | tee -a "$LOG"
        echo "$NEW_FAILURES" | sed 's/^/    /' | tee -a "$LOG"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
      FIXED_FAILURES=$(comm -23 "$BASELINE_FILE" <(echo "$CANDIDATE_FAILURES" | sed '/^$/d' | sort -u) | wc -l | tr -d ' ')
      echo "  Gate passed: no new failures (and $FIXED_FAILURES fewer than main)." | tee -a "$LOG"

      git -C "$WORKTREE_DIR" add -A
      git -C "$WORKTREE_DIR" commit -m "patrol: $desc" --no-verify

      # Push branch and create PR
      git -C "$WORKTREE_DIR" push -u origin "$FIX_BRANCH" 2>>"$LOG"
      PR_URL=$(gh pr create \
        --repo "$(git remote get-url origin | sed 's/\.git$//' | sed 's|.*github.com[:/]||')" \
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
*Automated patrol fix. Checks that actually ran: \`node test/validate.mjs\` passed, and the
Playwright suite ran against this branch in its own worktree with no failure that
\`origin/main\` was not already failing. The suite has pre-existing failures; this was
gated on introducing none, not on a green run.*
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
      SKIPPED=$((SKIPPED + 1))
    fi
  else
    echo "SKIPPED: no changes made" | tee -a "$LOG"
    SKIPPED=$((SKIPPED + 1))
  fi

  # Clean up worktree
  git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
  # If nothing was pushed, delete the branch
  if ! git rev-parse --verify "origin/$FIX_BRANCH" &>/dev/null; then
    git branch -D "$FIX_BRANCH" 2>/dev/null || true
  fi
done < "$ISSUES_FILE"

rm -f "$ISSUES_FILE"
fi  # end of COUNT != 0

# --- Phase 3: Run E2E test suite ---
echo "" | tee -a "$LOG"
echo "Phase 3: Running E2E test suite..." | tee -a "$LOG"

E2E_RESULT_FILE=$(mktemp)
if (cd "$PROJECT_DIR" && npx playwright test --reporter=json > "$E2E_RESULT_FILE" 2>>"$LOG"); then
  E2E_PASSED=$(python3 -c "import sys,json; r=json.load(open('$E2E_RESULT_FILE')); print(r['stats']['expected'])" 2>/dev/null || echo "?")
  echo "E2E: all $E2E_PASSED tests passed." | tee -a "$LOG"
else
  E2E_PASSED=$(python3 -c "import sys,json; r=json.load(open('$E2E_RESULT_FILE')); print(r['stats']['expected'])" 2>/dev/null || echo "?")
  E2E_FAILED=$(python3 -c "import sys,json; r=json.load(open('$E2E_RESULT_FILE')); print(r['stats']['unexpected'])" 2>/dev/null || echo "?")
  # Specs nest inside describe blocks, so this must recurse. A one-level walk
  # prints nothing, which produced an issue reporting 277 failures by name of
  # none of them, and nobody acts on a report that names nothing.
  E2E_FAILURES=$(python3 - "$E2E_RESULT_FILE" <<'PYEOF' 2>/dev/null || echo "  (could not parse failures)"
import json, sys
report = json.load(open(sys.argv[1]))
lines = []
def walk(node, path=None):
    path = node.get("file", path)
    for spec in node.get("specs", []):
        for test in spec.get("tests", []):
            if test.get("status") == "unexpected":
                results = test.get("results") or [{}]
                message = (results[0].get("error") or {}).get("message", "unknown")
                lines.append("  - %s :: %s: %s" % (path, spec.get("title"), message[:120]))
    for child in node.get("suites", []):
        walk(child, path)
for suite in report.get("suites", []):
    walk(suite)
print("\n".join(lines) if lines else "  (report parsed but listed no failing test)")
PYEOF
)
  echo "E2E: $E2E_PASSED passed, $E2E_FAILED FAILED." | tee -a "$LOG"
  echo "$E2E_FAILURES" | tee -a "$LOG"

  # Create an issue for E2E failures
  gh issue create \
    --title "patrol: E2E test failures ($E2E_FAILED failing)" \
    --label "patrol,bug" \
    --body "$(cat <<E2EEOF
**Date:** $(date +%Y-%m-%d)
**Passed:** $E2E_PASSED
**Failed:** $E2E_FAILED

**Failing tests:**
$E2E_FAILURES

---
*Automated patrol E2E run. Review failures and fix or update tests.*
E2EEOF
)" 2>>"$LOG" || true
fi
rm -f "$E2E_RESULT_FILE"

# --- Phase 4: Develop new tests for uncovered features ---
echo "" | tee -a "$LOG"
echo "Phase 4: Developing new tests for uncovered features..." | tee -a "$LOG"

TEST_DEV_BRANCH="patrol/${TIMESTAMP}-tests"
rm -rf "$WORKTREE_DIR" 2>/dev/null || true
git branch -D "$TEST_DEV_BRANCH" 2>/dev/null || true
git worktree add -b "$TEST_DEV_BRANCH" "$WORKTREE_DIR" origin/main 2>>"$LOG"

TEST_DEV_PROMPT="You are a test development bot for IrisFiles. Your working directory is $WORKTREE_DIR.

Your job: find features that lack E2E test coverage and write new Playwright tests.

Steps:
1. Read the existing test files in test/e2e/ to understand what is already covered
2. Read recent git changes: git log --oneline -20 and git diff HEAD~5 --stat
3. Read the JS engine and UI files to find features NOT yet tested
4. Write new tests in the EXISTING test files (add to the most appropriate file)
5. Follow the patterns in the existing tests exactly (imports, selectors, fixtures)
6. Focus on: new conversion routes, edge cases, error handling, UI controls
7. Available fixtures: sample.png, sample.jpg, sample.webp, sample.bmp, sample.gif, sample2.png, sample2.jpg, large.jpg, transparent.png, sample.pdf, sample2.pdf, sample.wav, sample.mp3, sample.ogg, sample.mp4, sample.mov, sample.avi, sample.rtf, sample.txt, sample.zip
8. Run: cd $WORKTREE_DIR && npx playwright test --reporter=line 2>&1 | tail -5
9. If new tests fail, fix them or remove them
10. Only commit tests that pass

Output a summary of what tests you added and why."

TEST_DEV_OUTPUT=$(claude --print \
  --model "$FIX_MODEL" \
  --dangerously-skip-permissions \
  --allowedTools "Read Glob Grep Edit Write Bash" \
  -p "$TEST_DEV_PROMPT" 2>>"$LOG") || true

echo "$TEST_DEV_OUTPUT" | tail -10 | tee -a "$LOG"

if [[ -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]]; then
  # Same baseline gate as the fix phase. Requiring a green suite here is what
  # silently disabled test-writing: the suite has never been green, so the only
  # agent able to repair the tests was blocked by the tests.
  echo "  Gate: running e2e against the new tests..." | tee -a "$LOG"
  TESTDEV_FAILURES=$(pw_failures "$WORKTREE_DIR")
  TESTDEV_NEW=$(comm -13 "$BASELINE_FILE" <(echo "$TESTDEV_FAILURES" | sed '/^$/d' | sort -u))
  if echo "$TESTDEV_FAILURES" | grep -q "PW_REPORT_UNREADABLE"; then
    echo "  REJECTED: e2e report unreadable; not committing new tests." | tee -a "$LOG"
    TESTDEV_NEW="unreadable"
  fi
  if [[ -z "$TESTDEV_NEW" ]]; then
    NEW_TESTS=$(git -C "$WORKTREE_DIR" diff --stat | grep -c 'spec.mjs' || echo 0)
    git -C "$WORKTREE_DIR" add -A
    git -C "$WORKTREE_DIR" commit -m "patrol: add E2E tests for uncovered features" --no-verify
    git -C "$WORKTREE_DIR" push -u origin "$TEST_DEV_BRANCH" 2>>"$LOG"
    PR_URL=$(gh pr create \
      --repo "$(git remote get-url origin | sed 's/\.git$//' | sed 's|.*github.com[:/]||')" \
      --base main \
      --head "$TEST_DEV_BRANCH" \
      --title "patrol: new E2E tests for uncovered features" \
      --label "patrol,tests" \
      --body "$(cat <<TESTEOF
**New tests added to $NEW_TESTS file(s).**

$(echo "$TEST_DEV_OUTPUT" | tail -20)

---
*Automated patrol test development. These tests ran in their own worktree and
introduced no failure that \`origin/main\` was not already failing.*
TESTEOF
)" 2>>"$LOG") || true
    if [[ -n "$PR_URL" ]]; then
      echo "Test PR created: $PR_URL" | tee -a "$LOG"
    fi
  else
    echo "SKIPPED: new tests introduce failures main was not already failing:" | tee -a "$LOG"
    echo "$TESTDEV_NEW" | sed 's/^/    /' | tee -a "$LOG"
  fi
else
  echo "No new tests needed." | tee -a "$LOG"
fi

git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
if ! git rev-parse --verify "origin/$TEST_DEV_BRANCH" &>/dev/null; then
  git branch -D "$TEST_DEV_BRANCH" 2>/dev/null || true
fi

echo "" | tee -a "$LOG"
echo "=== Patrol complete: $FIXED fixed, $SKIPPED skipped ===" | tee -a "$LOG"
echo "Full log: $LOG" | tee -a "$LOG"
