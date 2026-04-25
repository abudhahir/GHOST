# get-ghost

Fetch and install AI agent resources (agents, skills, prompts, instructions, rules) from any git repository.

```bash
npx get-ghost --repo https://github.com/org/repo --categories agents
```

---

## Getting Started

No installation required — run directly with `npx`:

```bash
npx get-ghost
```

get-ghost prompts for the repository URL, categories to install, and install mode if you don't supply flags.

---

## Usage

```
get-ghost [options]
get-ghost config <subcommand>
```

### Options

| Flag | Description |
|------|-------------|
| `--repo <url>` | Git repository URL |
| `--categories <list>` | Comma-separated categories or `all` |
| `--dest <path>` | Target directory (flat mode only) |
| `--token <token>` | Auth token for private repositories |
| `--host-type <type>` | Declare platform type (see below) |
| `-y, --yes` | Skip confirmation prompt |
| `--version` | Show version |
| `--help` | Show help |

### Examples

```bash
# Interactive mode — prompts for everything
npx get-ghost

# Fetch all agents from a public repo
npx get-ghost --repo https://github.com/org/repo --categories agents

# Fetch multiple categories, skip confirmation
npx get-ghost --repo https://github.com/org/repo --categories agents,skills -y

# Fetch all categories
npx get-ghost --repo https://github.com/org/repo --categories all

# Private repo with token
npx get-ghost --repo https://github.com/org/private --token ghp_xxx --categories agents

# Flat install into a specific folder
npx get-ghost --repo https://github.com/org/repo --categories agents --dest .claude/agents/

# Self-hosted GitLab
npx get-ghost --repo https://gitlab.internal.co/org/repo --host-type gitlab --categories agents
```

---

## Categories

get-ghost recognises five resource categories:

| Category | What it is |
|----------|-----------|
| `agents` | AI agent definitions (`.agent.md` files or `category: agents` frontmatter) |
| `skills` | Reusable skill documents |
| `prompts` | Prompt templates |
| `instructions` | Instruction sets |
| `rules` | Rule files (linting, style, workflow) |

Classification is determined in priority order:
1. `category:` field in YAML frontmatter
2. `.agent.md` file extension → `agents`
3. Ancestor directory name matching a known category

---

## Install Modes

### Mirror (default)

Preserves the source repository's directory structure:

```
repo/agents/search/refactor.md  →  ./agents/search/refactor.md
```

### Flat

Places all matched files into a single target directory, resolving name collisions with path-based prefixes:

```bash
npx get-ghost --repo https://github.com/org/repo --categories agents --dest .claude/agents/
```

```
repo/agents/search/refactor.md  →  .claude/agents/refactor.agent.md
repo/agents/coding/refactor.md  →  .claude/agents/search_refactor.agent.md  # collision resolved
```

---

## Config

Persist options so you don't repeat them on every run.

### Project config (`.ghost/config.json`)

```bash
get-ghost config set repo https://github.com/org/repo
get-ghost config set categories agents,skills
get-ghost config set installMode mirror
```

### User config (`~/.config/ghost/config.json`)

User-level defaults apply when no project config is present. Project-scoped keys (`repo`, `installMode`, `destinations`) are ignored in user config.

```bash
get-ghost config set token ghp_xxx        # stored in user config
```

### View merged config

```bash
get-ghost config list
```

### Destinations override

Map each category to a specific install path in `.ghost/config.json`:

```json
{
  "destinations": {
    "agents": ".claude/agents/",
    "rules": ".claude/rules/",
    "skills": ".claude/skills/"
  }
}
```

### Config merge order

CLI flags → project `.ghost/config.json` → user `~/.config/ghost/config.json` → defaults

---

## Platform Support

get-ghost auto-detects the platform from the repository URL. For self-hosted instances, use `--host-type`:

| Platform | Auto-detected | `--host-type` value |
|----------|--------------|---------------------|
| GitHub.com | Yes | `github` |
| GitHub Enterprise | No | `github-enterprise` |
| GitLab.com | Yes | `gitlab` |
| Self-hosted GitLab | Probed | `gitlab` |
| Bitbucket Cloud | Yes | `bitbucket-cloud` |
| Bitbucket Server | Probed | `bitbucket-server` |
| Gitea | Probed | `gitea` |

**Probe behaviour:** For unknown hostnames, get-ghost fires parallel requests to detect the platform automatically. If probing fails, it falls back to a shallow `git clone`.

### Private repositories

Pass a token via `--token` or store it in user config:

- **GitHub / GitHub Enterprise:** Personal access token
- **GitLab:** Personal or project access token
- **Bitbucket Cloud:** `username:app-password`
- **Bitbucket Server / Gitea:** Personal access token

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Partial failure — some files failed to download or write (listed to stderr) |
| `2` | Fatal error — authentication failure, repository not found, network error |

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run locally
node dist/index.js --help
```

### Test coverage

```bash
npm run test:coverage
```

Coverage thresholds: 80% statements / branches / functions / lines.
