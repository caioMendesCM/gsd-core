'use strict';

/**
 * Regression tests for bug #580
 *
 * Local-install `.sh` hooks on Claude Code + Windows were wrapped with the
 * ABSOLUTE Git Bash path returned by resolveBashRunner():
 *
 *   "C:/Program Files/Git/bin/bash.exe" "$CLAUDE_PROJECT_DIR"/.claude/hooks/gsd-session-state.sh
 *
 * Claude Code executes the hook command string *inside* Git Bash, so the
 * explicit bash.exe became the thing the outer bash tried to execute, failing
 * on every hook event with:
 *
 *   C:/Program Files/Git/bin/bash.exe: C:/Program Files/Git/bin/bash.exe: cannot execute binary file
 *
 * This is the same failure mode as #166/#377. The GLOBAL install path
 * (buildHookCommand) already guards Claude+win32 by dropping the wrapper; the
 * LOCAL install path (localShellCmd) never received the guard, so it kept
 * regenerating the bug. #428 notes the CI matrix omitted windows-latest, which
 * would have caught the regression.
 *
 * Fix: projectLocalShellHookRunner() returns bare `bash` for Claude on Windows
 * (guaranteed on PATH inside Claude's Git Bash hook shell) instead of the
 * absolute bash.exe path. Other runtimes (Gemini/Codex launch hooks from
 * PowerShell/cmd, #3393) keep the explicit runner.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const projection = require(path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'shell-command-projection.cjs'));
const { projectLocalShellHookRunner, projectLocalHookPrefix, projectShellCommandText } = projection;

// What resolveBashRunner() returns on Windows — the value that broke local installs.
const ABS_BASH = '"C:/Program Files/Git/bin/bash.exe"';

// Build a local .sh hook command the same way install.js's localShellCmd does,
// so the assertions reflect the actually-emitted settings.json command.
function buildLocalShellCommand({ runtime, platform, absoluteBashRunner, dirName, hookFile }) {
  const localPrefix = projectLocalHookPrefix({ runtime, dirName });
  const runner = projectLocalShellHookRunner({ runtime, platform, absoluteBashRunner });
  if (runner === null) return null;
  return projectShellCommandText({
    runnerToken: runner,
    argTokens: [`${localPrefix}/hooks/${hookFile}`],
    runtime,
    platform,
  });
}

describe('bug #580: local .sh hooks must not wrap with absolute bash.exe on Claude/Windows', () => {
  test('Claude on Windows projects bare `bash`, not the absolute bash.exe path', () => {
    assert.equal(
      projectLocalShellHookRunner({ runtime: 'claude', platform: 'win32', absoluteBashRunner: ABS_BASH }),
      'bash',
    );
  });

  test('composed Claude/Windows local .sh command does NOT re-wrap bash.exe (the #580 failure)', () => {
    const command = buildLocalShellCommand({
      runtime: 'claude',
      platform: 'win32',
      absoluteBashRunner: ABS_BASH,
      dirName: '.claude',
      hookFile: 'gsd-session-state.sh',
    });
    // Negative proof: the absolute bash.exe wrapper (which Claude's Git Bash
    // hook shell re-executes -> "cannot execute binary file") must be gone.
    assert.ok(!command.includes('bash.exe'), `command must not contain bash.exe: ${command}`);
    assert.ok(!command.includes('Program Files'), `command must not contain an absolute Git path: ${command}`);
    // Positive contract: bare bash + the $CLAUDE_PROJECT_DIR-anchored path (#1906).
    assert.equal(command, 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/gsd-session-state.sh');
  });

  test('all four managed local .sh hooks drop the absolute wrapper', () => {
    for (const hookFile of [
      'gsd-session-state.sh',
      'gsd-validate-commit.sh',
      'gsd-graphify-update.sh',
      'gsd-phase-boundary.sh',
    ]) {
      const command = buildLocalShellCommand({
        runtime: 'claude', platform: 'win32', absoluteBashRunner: ABS_BASH, dirName: '.claude', hookFile,
      });
      assert.ok(!command.includes('bash.exe'), `${hookFile}: must not wrap with bash.exe -> ${command}`);
      assert.equal(command, `bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/${hookFile}`);
    }
  });

  // ── Scope guard: the fix is Claude+win32 only ────────────────────────────
  test('non-Claude runtimes on Windows keep the explicit absolute bash runner (#3393)', () => {
    for (const runtime of ['gemini', 'codex', 'generic']) {
      assert.equal(
        projectLocalShellHookRunner({ runtime, platform: 'win32', absoluteBashRunner: ABS_BASH }),
        ABS_BASH,
        `${runtime} on Windows must keep the explicit bash runner`,
      );
    }
  });

  // ── Cross-platform: only Windows is affected ─────────────────────────────
  test('Claude on macOS/Linux is unchanged (resolveBashRunner already returns bare bash)', () => {
    for (const platform of ['darwin', 'linux']) {
      assert.equal(
        projectLocalShellHookRunner({ runtime: 'claude', platform, absoluteBashRunner: 'bash' }),
        'bash',
        `Claude on ${platform} must keep the passed-through runner`,
      );
    }
  });

  // ── Edge cases ───────────────────────────────────────────────────────────
  test('Claude+Windows registers even when resolveBashRunner() returned null', () => {
    // Before the fix, a null absolute bash runner skipped registration entirely.
    // Claude always runs hooks in Git Bash, so bare `bash` is always valid.
    assert.equal(
      projectLocalShellHookRunner({ runtime: 'claude', platform: 'win32', absoluteBashRunner: null }),
      'bash',
    );
  });

  test('non-Claude with a null absolute runner still returns null (caller skips registration)', () => {
    assert.equal(
      projectLocalShellHookRunner({ runtime: 'codex', platform: 'win32', absoluteBashRunner: null }),
      null,
    );
  });

  test('defaults are conservative (generic runtime, no win32 special-casing)', () => {
    assert.equal(
      projectLocalShellHookRunner({ absoluteBashRunner: ABS_BASH, platform: 'linux' }),
      ABS_BASH,
    );
  });
});
