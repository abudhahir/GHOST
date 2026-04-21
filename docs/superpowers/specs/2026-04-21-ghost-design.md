# GHOST — NPX/NPM Agent Resource Installer
**Date:** 2026-04-21
**Status:** Approved

---

## Overview

GHOST is a TypeScript CLI tool published to npm, runnable via `npx ghost`. It fetches AI agent resources (agents, skills, prompts, instructions, rules) from any git repository and installs them into the directory where the command is invoked. It uses host APIs to scan and selectively download only the requested resources — no full repo clone required for known hosts.

---

## Section 1: Architecture

GHOST has four clearly-separated responsibilities:

```
CLI Entry
    └── Argument Parser (commander.js)
         └── Interactive Prompter (@inquirer/prompts) [when flags missing]
              └── Fetcher
                   ├── HostDetector  → parses repo URL, identifies GitHub / GitLab / Bitbucket / unknown
                   ├── APITreeScanner → fetches recursive file tree via host API (no content download)
                   ├── FileFilter    → filters tree by requested categories (dir name + extension + frontmatter)
                   ├── FileDownloader → downloads only matched files via raw URLs (parallel, concurrency cap 5)
                   └── GitFallback   → shallow clone → scan → copy → cleanup (unknown/self-hosted hosts)
                        └── Installer
                             ├── MirrorInstaller  → writes files preserving source structure in cwd
                             └── FlatInstaller    → writes files into a single target dir (--dest flag)
```

**Key boundaries:**
- `Fetcher` accepts a plain config object and returns resolved file content + paths. It knows nothing about the CLI.
- `Installer` accepts file content + destination paths and writes them. It knows nothing about git or APIs.
- `HostDetector` is the only place containing host-specific logic.

---

## Section 2: CLI Interface & UX

### Named flags mode (all flags provided, no prompts)

```bash
npx ghost --repo https://github.com/org/repo --categories agents,skills
npx ghost --repo https://github.com/org/repo --categories agents --dest .ghost/
npx ghost --repo https://github.com/org/repo --categories all
npx ghost --repo https://github.com/org/repo --token ghp_xxx --categories prompts
npx ghost --repo https://git.company.com/org/repo --host-type gitlab --token xxx --categories agents
```

### Interactive mode (any flag omitted triggers prompts)

```
$ npx ghost
? Git repository URL: https://github.com/org/repo
? Categories to install: (use space to select)
  ❯◉ agents
   ◯ skills
   ◯ prompts
   ◯ instructions
   ◯ rules
? Install mode: (use arrows)
  ❯ Mirror source structure (default)
    Flat install into a folder
? Target folder: .ghost/          ← only shown if flat selected
```

### All flags

| Flag | Description | Default |
|---|---|---|
| `--repo` | Git repo URL | prompted |
| `--categories` | Comma-separated list or `all` | prompted |
| `--dest` | Target directory for flat mode | cwd |
| `--token` | Auth token for all requests to the resolved host for this invocation | none |
| `--host-type` | Skip probing, declare platform explicitly | auto-detected |
| `--yes` / `-y` | Skip confirmation summary | false |

Supported `--host-type` values: `github`, `gitlab`, `gitea`, `bitbucket-server`

**Note on `--token` scope:** The token applies to all HTTP requests (tree fetch, file downloads, probes) targeting the resolved host for a single invocation. It is not persisted across hosts.

**Note on Bitbucket Cloud auth:** Bitbucket Cloud uses HTTP Basic Auth (app passwords), not Bearer tokens. For Bitbucket Cloud, `--token` must be provided in the format `username:app_password`. Ghost will detect Bitbucket Cloud and encode this as `Authorization: Basic base64(value)` automatically.

### Pre-install confirmation summary

Always shown unless `--yes`:

```
Ready to install from https://github.com/org/repo
  agents  → ./.claude/agents/  (3 files)
  skills  → ./.claude/skills/  (7 files)
Proceed? (Y/n)
```

---

## Section 3: Resource Discovery & Classification

`FileFilter` receives the full recursive file tree (array of paths) and classifies each file using a priority-ordered ruleset.

### Classification priority (highest to lowest)

1. **Frontmatter override** — file contains YAML frontmatter with `category:` field whose value is a known category → use that value
2. **File extension convention** — filename ends with `.agent.md`, `.skill.md`, `.prompt.md`, `.instruction.md`, `.rule.md` → use the extension segment
3. **Ancestor directory name** — any path segment matches a known category name → use that category

### Frontmatter parsing rules

- Read lines from the top of the file until the closing `---` is found or EOF is reached.
- If no opening `---` on the first line: treat as no frontmatter, fall through to next rule.
- If opening `---` exists but closing `---` is absent (EOF reached): treat as no frontmatter, fall through.
- If `category:` key exists but value is not in the known category list: treat as absent, fall through.
- Frontmatter parsing does not full-parse YAML — only extracts the `category:` line value via simple string matching.

### Skipped files — user feedback

Files matching none of the three rules are skipped. Ghost always reports skipped file counts:
- If ALL scanned files are skipped: emit a warning to stderr listing total scanned and zero matched, then exit 2.
- If SOME files are skipped alongside matched files: emit a summary line to stderr: `Skipped N unrecognised files (use --verbose to list paths)`.

### Known categories and aliases

| Canonical | Aliases matched |
|---|---|
| `agents` | `agent` |
| `skills` | `skill` |
| `prompts` | `prompt`, `prompts` |
| `instructions` | `instruction`, `instructions` |
| `rules` | `rule`, `rules` |

### Classification examples

```
repo/agents/my-agent.md                    → agents   (directory rule)
repo/tools/coder.agent.md                  → agents   (extension rule)
repo/stuff/deploy.md                       → skipped  (no signal)
repo/prompts/chat.md                       → prompts  (directory rule)
  (with frontmatter: category: skills)     → skills   (frontmatter overrides directory)
repo/stuff/chat.md
  (with frontmatter: category: unknown)    → skipped  (unknown value, falls through, no other signal)
```

---

## Section 4: Fetch Strategy

### Step 1 — Host detection

| URL pattern | Platform | API base |
|---|---|---|
| `github.com` | GitHub Cloud | `api.github.com` |
| `gitlab.com` | GitLab Cloud | `gitlab.com/api/v4` |
| `bitbucket.org` | Bitbucket Cloud | `api.bitbucket.org/2.0` |
| unknown domain | → probe | detected at runtime |

### Step 2 — Self-hosted auto-detection via probing

For unknown domains, ghost sends lightweight probe requests in parallel. The `--token` is attached to all probe requests.

| Platform | Probe endpoint | Success condition |
|---|---|---|
| GitHub Enterprise Server | `GET {host}/api/v3` | Response body contains `"current_user_url"` |
| Self-hosted GitLab | `GET {host}/api/v4/version` | HTTP 200 |
| Gitea / Forgejo | `GET {host}/api/v1/version` | HTTP 200 |
| Bitbucket Server | `GET {host}/rest/api/1.0/application-properties` | HTTP 200 |

First successful probe wins. If all probes fail → git fallback. `--host-type` flag skips probing entirely.

### Step 3 — API tree fetch with full pagination

All paginated responses must be fully exhausted before proceeding to filtering.

**GitHub / GitHub Enterprise Server:**
```
GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1
```
Returns complete tree in one request. No pagination required (GitHub returns all entries in a single response when `recursive=1`).

**Self-hosted GitLab / GitLab Cloud:**
```
GET /api/v4/projects/{url-encoded-path}/repository/tree?recursive=true&per_page=100&page=1
```
Pagination: check `X-Next-Page` response header. If non-empty, repeat with `page={X-Next-Page}`. Continue until `X-Next-Page` is empty.

**Bitbucket Cloud:**
```
GET /2.0/repositories/{workspace}/{slug}/src?pagelen=100
```
Pagination: check `next` field in response body. If present, follow the URL directly. Continue until `next` is absent.

**Bitbucket Server / Data Center:**
```
GET /rest/api/1.0/projects/{project}/repos/{slug}/files?limit=500&start=0
```
Pagination: check `isLastPage` in response body. If `false`, repeat with `start={nextPageStart}`. Continue until `isLastPage: true`.

**Gitea / Forgejo:**
```
Step 1: GET /api/v1/repos/{owner}/{repo}                         → read .default_branch field
Step 2: GET /api/v1/repos/{owner}/{repo}/branches/{branch_name}  → read .commit.id (the SHA)
Step 3: GET /api/v1/repos/{owner}/{repo}/git/trees/{sha}?recursive=true
```
`{sha}` must be a resolved commit SHA — Gitea does not accept symbolic refs like `HEAD` in the trees endpoint. The default branch name is obtained from the repository metadata (`default_branch` field), then the SHA is resolved via the branch detail endpoint (`commit.id` field).

### Step 3b — Blob-only filtering

After tree fetch, before passing to `FileFilter`, discard all non-blob entries:
- **GitHub / GHES:** keep only entries where `type === "blob"`
- **GitLab:** keep only entries where `type === "blob"`
- **Bitbucket Cloud:** keep only entries where `type === "commit_file"`
- **Bitbucket Server:** all entries from the files endpoint are file paths (no directories returned)
- **Gitea:** keep only entries where `type === "blob"`

Directory entries must never be forwarded to `FileDownloader`.

**GitHub truncation handling:** If the GitHub tree response contains `"truncated": true`, Ghost must abort the API path and fall back to git clone for that repo. Print a warning: "Repository tree too large for API fetch, falling back to git clone."

### Step 4 — File download

For each matched file, fetch raw content via host raw URL:

| Platform | Raw content URL pattern |
|---|---|
| GitHub Cloud | `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{path}` |
| GitHub Enterprise | `https://{host}/{owner}/{repo}/raw/HEAD/{path}` |
| GitLab (cloud + self-hosted) | `GET /api/v4/projects/{encoded}/repository/files/{encoded-path}/raw?ref=HEAD` |
| Bitbucket Cloud | `GET /2.0/repositories/{ws}/{slug}/src/HEAD/{path}` |
| Bitbucket Server | `GET /rest/api/1.0/projects/{proj}/repos/{slug}/raw/{path}` |
| Gitea / Forgejo | `GET /api/v1/repos/{owner}/{repo}/raw/{path}?ref={sha}` |

Downloads run in parallel (concurrency cap: 5).

**Auth header per platform:**

| Platform | Header format |
|---|---|
| GitHub, GitLab, Gitea, GHES | `Authorization: Bearer {token}` |
| Bitbucket Cloud | `Authorization: Basic base64("{token}")` where `--token` is `username:app_password` |
| Bitbucket Server | `Authorization: Bearer {token}` (personal access token) |

### Step 5 — Git fallback (unknown hosts / all probes failed)

1. `git clone --depth 1 {repo} {tmpDir}`
2. Walk `tmpDir` recursively → pass paths to `FileFilter`
3. Read matched file content from disk
4. Delete `tmpDir` on completion or error (including on exception — wrapped in try/finally)

### Error handling

| Condition | Message | Exit |
|---|---|---|
| API 401/403 | "Private repo — provide --token" | 2 |
| API 404 | "Repo not found or inaccessible" | 2 |
| No files matched | "No matching resources found for requested categories" | 2 |
| All files skipped (no signal) | Warning to stderr + exit 2 | 2 |
| Partial download failure | List failed files to stderr, continue with successful ones | 1 |
| git not installed | "git is required for this repository host" | 2 |
| GitHub tree truncated | Warning + fall back to git clone automatically | — |

**Exit code precedence:** Exit 2 takes precedence over exit 1 when both conditions apply in the same invocation (e.g., partial download failure AND a fatal auth error on a second category).

---

## Section 5: Install & File Writing

### Mirror mode (default — no `--dest`)

Preserves the source repo's directory structure relative to matched files, written into cwd.

When `destinations` config is set for a category, that path is used as the root instead of cwd for that category. Categories absent from `destinations` fall back to `--dest` if set, otherwise cwd.

```
Source repo path                         Written to (destinations.agents = .claude/agents/)
agents/coding/refactor.agent.md    →    .claude/agents/coding/refactor.agent.md
tools/search.skill.md              →    ./tools/search.skill.md  (no destinations.skills set, falls back to cwd)
```

### Flat mode

Activated by either: the presence of `--dest` CLI flag OR `installMode: "flat"` in project config.
When flat mode is active without an explicit destination (`--dest` absent and no `destinations` config), cwd is used as the output folder.

All matched files written directly into the target folder, structure stripped.

**Collision resolution:** When two source files produce the same destination filename, resolve by replacing path separators in the full relative source path with underscores:

```
Source repo path                         Written to .ghost/
agents/coding/refactor.agent.md    →    .ghost/refactor.agent.md
agents/search/refactor.agent.md    →    .ghost/search_refactor.agent.md
agents/foo/refactor.agent.md       →    .ghost/foo_refactor.agent.md
```

If collision persists after full-path underscore substitution (identical relative paths across two different repos in the same invocation — not possible by design), append a numeric suffix `_2`, `_3`, etc.

`destinations` per-category config takes priority over `--dest` for that specific category. Categories absent from `destinations` use `--dest` (or cwd if `--dest` also absent).

### Write behaviour

- Always overwrites existing files
- Creates intermediate directories as needed
- Atomic writes: tmp file created in the **same resolved absolute directory as the destination file** (ensures same-filesystem rename — not in `os.tmpdir()` or any other location), written, then renamed to the final path. On any failure, tmp file is deleted.

### Post-install summary

```
Installed 10 files from https://github.com/org/repo
  agents    (3)  →  ./.claude/agents/
  skills    (7)  →  ./.claude/skills/
Skipped 2 unrecognised files
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All files written successfully |
| `1` | Partial failure — some files failed to download or write, listed to stderr |
| `2` | Fatal error — auth failure, repo not found, no matches, all files unrecognised |

---

## Section 6: Configuration & Settings

### Config file locations

| Level | Path | Purpose |
|---|---|---|
| User | `~/.config/ghost/config.json` | Global defaults across all projects |
| Project | `.ghost/config.json` (in cwd) | Project-specific overrides |

### Resolution order (highest → lowest priority)

```
CLI flags  >  project config (.ghost/config.json)  >  user config (~/.config/ghost/config.json)  >  built-in defaults
```

### User config schema (`~/.config/ghost/config.json`)

User-scoped keys: `token`, `hostType`, `categories`.

```json
{
  "token": "ghp_xxx",
  "hostType": "github",
  "categories": ["agents", "skills"]
}
```

`installMode` is **project-scoped only** and cannot be set in user config.

### Project config schema (`.ghost/config.json`)

Project-scoped keys: `repo`, `categories`, `destinations`, `installMode`.

```json
{
  "repo": "https://github.com/org/my-agent-library",
  "categories": ["agents", "skills", "prompts"],
  "destinations": {
    "agents":       ".claude/agents/",
    "skills":       ".claude/skills/",
    "prompts":      ".claude/prompts/",
    "instructions": ".claude/instructions/",
    "rules":        ".claude/rules/"
  },
  "installMode": "mirror"
}
```

**`destinations` resolution:**
- A category present in `destinations` uses that path as its install root (ignores `--dest` for that category).
- A category absent from `destinations` falls back to `--dest` if provided, otherwise cwd.

### Config CLI commands

```bash
npx ghost config set token ghp_xxx        # writes to user config (user-scoped key)
npx ghost config set hostType github      # writes to user config (user-scoped key)
npx ghost config set repo https://...     # writes to project config (project-scoped key)
npx ghost config set installMode flat     # writes to project config (project-scoped key)
npx ghost config list                     # prints merged effective config
```

`ghost config set` determines the target config file by the key's scope (user vs project). Unknown keys are rejected with an error.

---

## Section 7: Testing Strategy

### Unit tests — pure logic, no network/disk

| Module | What's tested |
|---|---|
| `HostDetector` | Correctly identifies GitHub, GitLab, Bitbucket, unknown from URLs |
| `FileFilter` | Classification priority: frontmatter > extension > directory; aliases; skip unmatched; malformed frontmatter fallthrough; unknown category value fallthrough |
| `FlatInstaller` | Full-path underscore collision resolution; numeric suffix for persistent collision |
| `ConfigLoader` | Merge order: flags > project > user > defaults; `destinations` fallback to `--dest` then cwd |
| `FrontmatterParser` | Extracts `category:` from YAML block; missing closing `---`; unknown value; no frontmatter |

### Integration tests — real filesystem, mocked HTTP

| Scenario | What's tested |
|---|---|
| GitHub API happy path | Tree fetch → filter → download → write to mirror structure |
| GitLab API pagination | Multi-page tree response fully consumed before filtering |
| Bitbucket Cloud pagination | `next` cursor followed until absent |
| Bitbucket Server pagination | `isLastPage` + `nextPageStart` loop |
| Gitea SHA resolution | Default branch SHA resolved before tree fetch |
| GitLab API happy path | Same flow with GitLab raw URLs |
| API 401 response | Clear error message, exit code 2 |
| All files skipped | Warning to stderr, exit code 2 |
| No matches found | Warning + exit code 2 |
| Git fallback | Spins up local bare repo, clones, scans, installs |
| Config file merge | Project config overrides user config; absent `destinations` key falls back to `--dest` |
| Flat install collision | Two files same relative path after stripping → full-path underscore prefix |
| Atomic write | Tmp file in same dir as destination; renamed successfully; tmp deleted on failure |
| Bitbucket Cloud Basic auth | Token encoded as Basic auth, not Bearer |
| Self-hosted probe sequence | Probes fire in parallel; first 200 wins; all fail → git fallback |
| GitHub tree truncated | `truncated: true` in response → falls back to git clone automatically |
| Blob-only filtering | Directory entries excluded from download on GitHub, GitLab, Bitbucket Cloud, Gitea |
| flat mode via config | `installMode: "flat"` in project config activates flat mode without `--dest` flag |
| exit code precedence | Fatal error + partial failure in same invocation → exit 2 |

### E2E test

Single test using a public GitHub fixture repo at `github.com/{org}/ghost-fixture` (created and owned by the GHOST project maintainers). The commit SHA used is stored in `tests/e2e/fixture.config.ts` as a named constant — not floating HEAD. This fixture repo must contain at least one file per supported category using each classification method (directory, extension, frontmatter). Runs `npx ghost` via `child_process.exec`, verifies files land correctly in a temp directory.

### Test tooling

- **Test runner:** Vitest
- **HTTP mocking:** `nock`
- **Temp directories:** `tmp`
- **Coverage target:** 80%+

---

## Tech Stack

| Concern | Library |
|---|---|
| Language | TypeScript |
| CLI parsing | `commander.js` |
| Interactive prompts | `@inquirer/prompts` |
| Git fallback | `simple-git` |
| HTTP requests | `undici` (Node built-in fetch wrapper) |
| Test runner | Vitest |
| HTTP mocking | `nock` |
| Build/publish | `tsup` |
