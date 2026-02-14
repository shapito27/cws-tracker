---
name: structuring-claude-md-files
description: Guides the creation and organization of CLAUDE.md files for projects. Use when setting up a new project for Claude Code, creating or restructuring CLAUDE.md files, onboarding AI-assisted development, or when the user asks about CLAUDE.md best practices, project context files, or how to organize instructions for Claude.
---

# Structuring CLAUDE.md Files

## Core Principle

**Proximity = Relevance.** Place context close to the code it describes. This minimizes token waste and gives Claude focused instructions for the current task.

## When to Split

**Single root file only** when the project is small, single-language, and fits in ~100-150 lines.

**Root + component files** when the project has distinct components (backend, frontend, infra), different languages/frameworks per component, or total context exceeds ~150 lines.

## File Hierarchy

### Root `CLAUDE.md` - Project Identity

Answers: "What is this project and how do the pieces fit together?"

Include:
- Project name and one-line description
- Architecture overview (components and how they communicate)
- Tech stack summary
- Repository structure map (top-level dirs and purpose)
- Shared conventions (naming, git workflow, branch strategy)
- Environment setup and key config
- References to component-level CLAUDE.md files

Exclude: deep framework patterns, exhaustive API lists, component-specific commands.

### Component `CLAUDE.md` - Working Context

Answers: "How do I work effectively in this specific codebase?"

Include:
- Framework version and key dependencies
- Directory structure within the component
- Code patterns and conventions
- Common commands (build, test, lint, migrate)
- Key files and entry points
- Testing approach
- Known gotchas

See [examples.md](examples.md) for complete root and component CLAUDE.md templates.

## Writing Guidelines

- **Be specific, not abstract.** "Services never call other services directly - use events via EventEmitter2" beats "Follow clean code principles."
- **Include the 'why' for non-obvious decisions.** "No barrel exports - they break tree-shaking and slow HMR."
- **Use code blocks for commands and patterns.** Scannable beats prose-heavy.
- **Write for the task, not for documentation.** CLAUDE.md is not a README. Skip marketing language and badges.
- **Only document actual patterns.** Aspirational rules nobody follows create confusion.

## What to Exclude

- Secrets or credentials (use .env references)
- Auto-generated content (API specs belong in OpenAPI files)
- Lengthy tutorials (link to docs instead)
- Frequently changing data (sprint goals, version numbers that update weekly)
- Obvious information ("JavaScript files end in .js")

## Maintenance

- Update on architecture changes
- Review quarterly - check documented patterns match reality
- Keep it lean - remove unused sections
- Treat CLAUDE.md changes as code review material in PRs