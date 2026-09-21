# IrisFiles

Privacy-first client-side file converter. See [README.md](README.md) for project overview and [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.

## Commands
- `npm run dev` - Dev server (`npx serve . -p 3000`)
- `npm test` - Validation suite (155 pages)
- `npm run test:e2e` - Playwright e2e suite (test/e2e, own server on :3988)
- `IRIS_TEST_BASE_URL=https://irisfiles.com npx playwright test` - run the suite against
  the deployed site instead of a local server. Catches what only exists once deployed:
  a path `.vercelignore` excludes, a CDN header overriding `vercel.json`.
- `bash build.sh` - Rebuild WASM + fflate (rarely needed)
- `git push origin main` - Deploy (Vercel auto-deploy). `.git/hooks/pre-push` runs `npm test`
  plus the e2e suite first and refuses the push if either fails; override once with
  `CLAUDE_ALLOW_UNTESTED_PUSH=1`. `patrol.sh` runs from the same hook, opt-in via
  `PATROL_ON_PUSH=1`.
- `bash scripts/merge-pr.sh <n>` - Merge a PR after running the suite against its merge
  result in a throwaway worktree. Use this rather than `gh pr merge`: merging on GitHub
  deploys without running anything, because the pre-push hook only sees `git push`.
- **Never run two suites at once on the same port.** `webServer.reuseExistingServer` is on
  by default, and a reused server serves *its own* directory, so the second run grades the
  first run's tree and can report green for code it never loaded. `merge-pr.sh` now exports
  `IRIS_TEST_NO_REUSE=1` and a per-PR `IRIS_TEST_PORT`. For any manual run alongside one,
  pass both yourself. `.git/hooks/pre-push` has the same exposure and cannot be fixed in the
  repo, since it lives outside the working tree.
- **There is no CI.** A PR's only checks are `Vercel` and `Vercel Preview Comments`, both
  preview builds. Green checks say nothing about tests. That gap let #166 merge carrying a
  test that could never pass.

## Conventions
- One HTML page per tool, unique SEO meta, shared JS via ES module imports
- Format detection uses magic bytes, not file extensions
- Heavy libraries lazy-loaded from jsDelivr CDN (ExifReader, piexifjs, FFmpeg.wasm, pdf-lib, etc.)
- Engine/UI/Boot pattern: `*-engine.js` (pure functions), `*-ui.js` (DOM controller), `*-boot.js` (2-line bootstrapper)
- **Stale async results need a generation token.** Any tool whose source the user can
  replace or clear mid-operation must capture a counter when the run starts and drop the
  result if the counter moved: `pdf-tools-ui.js`, `html-pdf-ui.js` and `font-ui.js` each
  do this. Capturing without incrementing is only safe while the action button stays
  `disabled` for the whole async window, which is what makes a second concurrent run
  impossible. `pending-store.js` is the IndexedDB page-handoff store and is not this.
- Safeguards: 100MB file limit, 100MP pixel limit, 50-file batch cap, 50MB PDF merge limit
- Adding a new tool: create HTML + engine + UI + boot, add to index.html Image Tools row, smart-drop.js routes, sitemap.xml, test/validate.mjs PAGES array + sitemap count

## Where files go
- **Root is the deploy directory** (`vercel.json` → `"outputDirectory": "."`). A root filename is a
  live URL. Never move a root `.html` into a subdirectory.
- **`patrol.sh` must stay at the repo root** — `.git/hooks/pre-push` invokes it by path, and that
  hook is outside the working tree where no in-repo search will find it.
- Documentation lives in exactly three root files: README.md (what and why), ARCHITECTURE.md (how),
  CLAUDE.md (working conventions). Do not start a `docs/` directory.
- Generated data goes in `data/`, with its generator in `scripts/` under a matching stem.
- One-off, non-site work (launch posts, experiments) gets its own directory named for the concept,
  not for its status — see `reddit/`. No `output/`, `misc/`, `archive/`, or `tmp/`.
- Versioning is git history. No `-v2`, `.old`, or `.bak` filename suffixes.
- Tool state (`.patrol/`, `.project-state/`, `.serena/`, `.claude/`, `.codegraph.db*`,
  `test-results/`) is regenerable and gitignored. Never file it as project content.
