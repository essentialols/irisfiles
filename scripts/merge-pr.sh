#!/bin/bash
# Run the suite against a PR's merge result, then merge it.
#
# The pre-push hook only sees `git push`, so merging on GitHub deploys without
# running anything. This closes that path: it builds the merge result in a
# throwaway worktree, runs the suite there, and merges only if it is green.
#
#   bash scripts/merge-pr.sh 179
#
# Override once with CLAUDE_ALLOW_UNTESTED_PUSH=1 to merge without the suite.
set -euo pipefail

pr="${1:?usage: bash scripts/merge-pr.sh <pr-number>}"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git fetch --quiet --prune
head_ref="$(gh pr view "$pr" --json headRefName -q .headRefName)"
base_ref="$(gh pr view "$pr" --json baseRefName -q .baseRefName)"
echo "merge-pr: #$pr  $head_ref -> $base_ref"

if [[ "${CLAUDE_ALLOW_UNTESTED_PUSH:-0}" == "1" ]]; then
  echo "merge-pr: CLAUDE_ALLOW_UNTESTED_PUSH=1 set, merging without running the suite." >&2
  gh pr merge "$pr" --squash --delete-branch
  exit 0
fi

# Inside .git so it is neither deployed nor picked up by a search of the tree.
work="$repo_root/.git/premerge-$pr"
cleanup() {
  cd "$repo_root"
  git worktree remove --force "$work" >/dev/null 2>&1 || true
  git worktree prune
}
trap cleanup EXIT

cleanup
git worktree add --quiet --detach "$work" "origin/$base_ref"
cd "$work"

if ! git merge --no-edit --quiet "origin/$head_ref"; then
  echo "merge-pr: BLOCKED. #$pr does not merge cleanly into $base_ref." >&2
  exit 1
fi

# A worktree has no node_modules of its own, and installing a second copy for a
# throwaway check would cost more than the check.
ln -s "$repo_root/node_modules" node_modules

log="$repo_root/.patrol/merge-pr-$pr-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$repo_root/.patrol"

# The suite's webServer reuses an already-listening server by default, and that
# server belongs to whatever directory started it. A dev server, a patrol run or
# a second gate on the default port would therefore be graded INSTEAD of this
# merge result, and the gate would report green for code it never loaded.
# Observed 2026-09-20: a suite run alongside a gate silently tested the gate's
# tree and reported pages as missing markup they in fact had.
# So: refuse reuse, and take a per-PR port. If that port is busy the suite fails
# to start and the merge is blocked, which is the safe direction.
export IRIS_TEST_NO_REUSE=1
export IRIS_TEST_PORT="${IRIS_TEST_PORT:-$((3990 + pr % 1000))}"
echo "merge-pr: running the suite on the merge result (port $IRIS_TEST_PORT, log: ${log#"$repo_root"/})"

if ! npm test >>"$log" 2>&1; then
  echo "merge-pr: BLOCKED. validation suite failed." >&2
  tail -5 "$log" >&2
  exit 1
fi

# Retries off: a test that only passes on the second attempt is a finding, not a pass.
if ! IRIS_TEST_RETRIES=0 npx playwright test >>"$log" 2>&1; then
  echo "merge-pr: BLOCKED. e2e suite failed." >&2
  grep -E "✘|[0-9]+ (failed|flaky)" "$log" | tail -20 >&2
  echo "merge-pr: full output in ${log#"$repo_root"/}" >&2
  exit 1
fi

echo "merge-pr: suite green, merging #$pr"
cd "$repo_root"
gh pr merge "$pr" --squash --delete-branch
echo "merge-pr: merged."
