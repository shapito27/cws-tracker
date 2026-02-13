---
name: todo-next
description: Find next unchecked TODO task group with dependency status and PRD context
allowed-tools: Read, Glob, Grep
---

# Find Next TODO Task

Identify the next actionable task group from the implementation plan.

## Instructions

### Step 1: Read the TODO file

Read `CWS_Tracker_TODO.md` and find all task groups (section headers like `### X.Y Task Name`).

For each task group, determine its status:
- **Done**: All checkboxes `- [x]` are checked
- **In progress**: Some checkboxes checked, some unchecked
- **Pending**: All checkboxes are unchecked `- [ ]`

### Step 2: Find the first actionable group

Scan from top to bottom. The first task group that has unchecked items (`- [ ]`) is the candidate.

### Step 3: Check dependencies

Look for dependency markers like `[depends: X.Y]` in the task group or its section header. For each dependency:
- Read the referenced task group
- Verify ALL its checkboxes are checked
- If any dependency is incomplete, note it and move to the next candidate group

### Step 4: Read PRD context

The task groups correspond to PRD sections. Read `CWS_Tracker_PRD_v2.md` and find the section most relevant to the task group (match by feature name or section number).

### Step 5: Present the result

Output a summary:

```markdown
## Next Task: [X.Y] Task Group Name

### Status
- Total tasks: N
- Completed: M
- Remaining: N-M

### Dependencies
- [X.Y] Dependency Name — Done / NOT DONE

### Tasks to Complete
- [ ] Task description 1
- [ ] Task description 2
...

### PRD Context
[Relevant PRD section summary — key requirements and acceptance criteria]

### Suggested Approach
[Brief recommendation on implementation order within the group]
```

If ALL task groups are complete, congratulate the user and suggest next steps (testing, release, etc.).
