---
name: version-bump
description: Bump manifest.json version and generate CHANGELOG entry from recent commits
allowed-tools: Read, Edit, Bash(git log:*), Bash(git diff:*), Bash(git tag:*), AskUserQuestion
---

# Version Bump

Increment the extension version and update the changelog.

<current_version>
!`node -p "require('./manifest.json').version"`
</current_version>

<recent_commits>
!`git log --oneline --no-merges -20`
</recent_commits>

<latest_tag>
!`git describe --tags --abbrev=0 2>/dev/null || echo "no tags"`
</latest_tag>

<commits_since_last_version>
!`git log --oneline --no-merges $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD 2>/dev/null || git log --oneline --no-merges -20`
</commits_since_last_version>

## Instructions

### Step 1: Determine bump type

Check `$ARGUMENTS` for an explicit bump type: `major`, `minor`, or `patch`.

If not specified, infer from the commits above:
- **MINOR** (X.Y+1.0): new features (`feat:`, `Add`, new files)
- **PATCH** (X.Y.Z+1): bug fixes (`fix:`, `Fix`, corrections)

Ask the user to confirm the bump type if it's ambiguous.

### Step 2: Calculate new version

Parse the current version from `<current_version>`. Apply semver bump:
- `major`: X+1.0.0
- `minor`: X.Y+1.0
- `patch`: X.Y.Z+1

### Step 3: Update manifest.json

Edit `manifest.json` to update the `"version"` field to the new version.

### Step 4: Generate CHANGELOG entry

Categorize commits since the last version into sections:
- **Added** — new features
- **Enhanced** — improvements to existing features
- **Fixed** — bug fixes
- **Changed** — refactors, dependency updates
- **Removed** — deleted features

Only include sections that have entries. Use this format:

```markdown
## [NEW_VERSION] - YYYY-MM-DD

### Added
- Description of feature

### Fixed
- Description of fix
```

### Step 5: Update CHANGELOG.md

Read `CHANGELOG.md` and prepend the new entry after the `# Changelog` header and the description line, before the first existing `## [` entry.

### Step 6: Show diff

Show the user what changed:
- `manifest.json` version field
- New CHANGELOG entry

Wait for user confirmation before considering the task complete.
