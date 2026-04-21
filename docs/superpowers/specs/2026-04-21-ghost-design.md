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
| `--token` | Auth token for private repos | none |
| `--host-type` | Skip probing, declare platform explicitly | auto-detected |
| `--yes` / `-y` | Skip confirmation summary | false |

Supported `--host-type` values: `github`, `gitlab`, `gitea`, `bitbucket-server`

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

1. **Frontmatter override** — file contains YAML frontmatter with `category:` field → use that value
2. **File extension convention** — filename ends with `.agent.md`, `.skill.md`, `.prompt.md`, `.instruction.md`, `.rule.md` → use the extension segment
3. **Ancestor directory name** — any path segment matches a known category name → use that category

Files matching none of the above are silently skipped.

### Known categories and aliases

| Canonical | Aliases matched |
|---|---|
| `agents` | `agent` |
| `skills` | `skill` |
| `prompts` | `prompt`, `prompts` |
| `instructions` | `instruction`, `instructions` |
| `rules` | `rule`, `rules` |

### Frontmatter parsing

Lightweight — reads only the opening `---` block looking for `category:`. Does not require full YAML parse of the file body.

### Classification examples

```
repo/agents/my-agent.md           → agents   (directory rule)
repo/tools/coder.agent.md         → agents   (extension rule)
repo/stuff/deploy.md              → skipped  (no signal)
repo/prompts/chat.md              → prompts  (directory rule)
  (with frontmatter: category: skills) → skills (frontmatter overrides directory)
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

For unknown domains, ghost sends lightweight probe requests in parallel:

```
Probe 1: GET {host}/api/v3/meta          → GitHub Enterprise Server
Probe 2: GET {host}/api/v4/version       → Self-hosted GitLab
Probe 3: GET {host}/api/v1/version       → Gitea / Forgejo
Probe 4: GET {host}/rest/api/1.0/...     → Bitbucket Server/Data Center
```

First successful response wins. If all probes fail → git fallback.
`--host-type` flag skips probing entirely.

### Step 3 — API tree fetch (known/detected hosts)

| Platform | Tree API |
|---|---|
| GitHub / GHES | `GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1` |
| GitLab | `GET /api/v4/projects/{encoded}/repository/tree?recursive=true&per_page=100` |
| Bitbucket Cloud | `GET /2.0/repositories/{ws}/{slug}/src?pagelen=100&recursive=true` |
| Bitbucket Server | `GET /rest/api/1.0/projects/{proj}/repos/{slug}/files?limit=1000` |
| Gitea/Forgejo | `GET /api/v1/repos/{owner}/{repo}/git/trees/{sha}?recursive=true` |

Flow:
1. Fetch full recursive tree → array of `{ path, type }` objects
2. Pass paths to `FileFilter` → get matched files with category
3. Download matched files in parallel (concurrency cap: 5) via host raw content URLs
4. If token provided, attach as `Authorization: Bearer {token}` on all requests

### Step 4 — Git fallback (unknown hosts / probe failure)

1. `git clone --depth 1 {repo} {tmpDir}`
2. Walk `tmpDir` recursively → pass paths to `FileFilter`
3. Read matched file content from disk
4. Delete `tmpDir` on completion or error

### Error handling

| Condition | Message | Exit |
|---|---|---|
| API 401/403 | "Private repo — provide --token" | 2 |
| API 404 | "Repo not found or inaccessible" | 2 |
| No files matched | "No matching resources found for requested categories" | 2 |
| Partial download failure | List failed files, continue with successful ones | 1 |
| git not installed | "git is required for this repository host" | 2 |

---

## Section 5: Install & File Writing

### Mirror mode (default — no `--dest`)

Preserves the source repo's directory structure relative to matched files, written into cwd:

```
Source repo path                         Written to cwd
agents/coding/refactor.agent.md    →    ./agents/coding/refactor.agent.md
tools/search.skill.md              →    ./tools/search.skill.md
deep/nested/dir/chat.prompt.md     →    ./deep/nested/dir/chat.prompt.md
```

When `destinations` config is set for a category, that path is used as the root instead of cwd:

```
agents/coding/refactor.agent.md    →    .claude/agents/coding/refactor.agent.md
```

### Flat mode (`--dest <path>`)

All matched files written directly into the target folder, structure stripped. Filename collisions within the same category resolved by prefixing the immediate parent directory:

```
Source repo path                         Written to .ghost/
agents/coding/refactor.agent.md    →    .ghost/refactor.agent.md
agents/search/refactor.agent.md    →    .ghost/search_refactor.agent.md  ← collision prefixed
```

### Write behaviour

- Always overwrites existing files
- Creates intermediate directories as needed (`mkdir -p` equivalent)
- Atomic writes: content written to `{dest}.ghost_tmp` then renamed to prevent partial writes on failure

### Post-install summary

```
Installed 10 files from https://github.com/org/repo
  agents    (3)  →  ./.claude/agents/
  skills    (7)  →  ./.claude/skills/
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All files written successfully |
| `1` | Partial failure — some files failed, listed to stderr |
| `2` | Fatal error — auth failure, repo not found, no matches |

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

```json
{
  "token": "ghp_xxx",
  "hostType": "github",
  "categories": ["agents", "skills"]
}
```

### Project config schema (`.ghost/config.json`)

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

`destinations` per-category paths take priority over `--dest` flag for their specific category.

### Config CLI commands

```bash
npx ghost config set token ghp_xxx        # writes to user config
npx ghost config set repo https://...     # writes to project config
npx ghost config list                     # prints merged effective config
```

---

## Section 7: Testing Strategy

### Unit tests — pure logic, no network/disk

| Module | What's tested |
|---|---|
| `HostDetector` | Correctly identifies GitHub, GitLab, Bitbucket, unknown from URLs |
| `FileFilter` | Classification priority: frontmatter > extension > directory; aliases; skip unmatched |
| `FlatInstaller` | Collision prefixing logic |
| `ConfigLoader` | Merge order: flags > project > user > defaults |
| `FrontmatterParser` | Extracts `category:` from YAML block; ignores malformed |

### Integration tests — real filesystem, mocked HTTP

| Scenario | What's tested |
|---|---|
| GitHub API happy path | Tree fetch → filter → download → write to mirror structure |
| GitLab API happy path | Same flow with GitLab raw URLs |
| API 401 response | Clear error message, exit code 2 |
| No matches found | Warning + exit code 2 |
| Git fallback | Spins up local bare repo, clones, scans, installs |
| Config file merge | Project config overrides user config correctly |
| Flat install collision | Two files same name → parent-prefixed correctly |
| Atomic write | Tmp file renamed, not left on partial failure |
| Self-hosted probe | Probe sequence identifies GitLab self-hosted correctly |

### E2E test

Single test using a real public GitHub fixture repo (owned by the project). Runs `npx ghost` via `child_process.exec`, verifies files land correctly in a temp directory.

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
