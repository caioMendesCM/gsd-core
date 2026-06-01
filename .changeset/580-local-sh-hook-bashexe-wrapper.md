---
type: Fixed
pr: 580
---
**Local-install Claude `.sh` hooks on Windows** — installer-managed local hooks no longer wrap `.sh` command entries with the absolute `bash.exe` path on Claude Code + Windows. Claude executes hook commands inside Git Bash, so the explicit `bash.exe` was re-executed as a script (`bash.exe: ... cannot execute binary file`) on every SessionStart/PreToolUse/PostToolUse event. The local-install path now uses bare `bash`, mirroring the existing global-install guard (#166).
