---
name: autter-cli-setup
version: 1.0.0
description: Install and set up the Autter CLI (AI authorship tracking for Git) on the user's machine — download, PATH, IDE/agent hooks, and onboarding — and troubleshoot the common install failures.
tags: [autter, cli, install, setup, onboarding, git]
author: autter
---

# Autter CLI setup

You are installing the **Autter CLI** — an open-source Git extension that
records which lines were written by AI agents and links them to the agent,
model, and prompts behind them (github.com/Autter-dev/autter-cli). It works
fully locally; connecting to the autter.dev platform is optional.

Follow the steps in order. Each step says what to run, what success looks
like, and what to do when it fails.

## Step 1: Check for an existing install

```bash
command -v autter || ls "$HOME/.autter/bin/autter" 2>/dev/null
```

- Found and `autter --version` works → skip to **Step 4** (hooks) to make
  sure editor integration is current, then **Step 5** (onboarding status).
- Found on disk but `command -v` fails → the binary is installed but PATH
  isn't set up in this shell; go to **Step 3**.
- Not found → **Step 2**.

## Step 2: Install

**macOS, Linux, WSL:**

```bash
curl -sSL https://autter.dev/install.sh | bash
```

Pipe to **bash**, not `sh`. The script is a bash script; under POSIX-mode
shells older releases print stray `-e` prefixes and may misbehave.

**Windows (native, PowerShell):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://autter.dev/install.ps1 | iex"
```

**Nix / NixOS / Home Manager:** don't use the script — point the user to
the repo's `README-nix.md`.

The installer downloads the binary to `~/.autter/bin`, symlinks it into
`~/.local/bin`, adds `~/.autter/bin` to every detected shell config
(`.bashrc`/`.bash_profile`, `.zshrc`, fish), and runs `autter install-hooks`
to configure supported editors and coding agents.

Do **not** run it with `sudo` — root-owned files under `~/.autter` cause
persistent daemon lock failures later.

## Step 3: Verify PATH and binary

The installer edits shell configs, but the *current* shell won't see them.
For this session use the full path or export inline:

```bash
export PATH="$HOME/.autter/bin:$PATH"
autter --version
autter debug
```

Tell the user to close and reopen their terminal and IDE afterwards — the
IDE integration in particular only picks up the hooks in fresh sessions.

If `autter --version` fails even with the full path on macOS, clear the
quarantine flag: `xattr -d com.apple.quarantine ~/.autter/bin/autter`.

## Step 4: Editor / agent hooks

The installer already ran this, but it's idempotent — re-run any time:

```bash
autter install-hooks
```

What to expect, and known noise:

- **"Extension 'autter.autter-vscode' not found" repeated in red, then a
  `.vsix` success line.** Benign on older CLI versions. The extension is
  published on **Open VSX**, not the Microsoft Marketplace, so the ID-based
  install fails before the installer falls back to downloading the `.vsix`
  from Open VSX — which succeeds. Only treat it as a failure if the final
  line is *not* `✓ VS Code: Extension installed`.
- **Extension install actually failed** (e.g. open-vsx.org blocked by a
  proxy): download the `.vsix` manually from
  `https://open-vsx.org/extension/autter/autter-vscode` and run
  `code --install-extension <file>.vsix` (same for `cursor` / `windsurf`
  CLIs). Do not send users to the Microsoft Marketplace — there is no
  listing there.
- **GitHub Codespaces:** extensions can't be installed from the CLI; add to
  `devcontainer.json`:
  `"customizations": { "vscode": { "extensions": ["autter.autter-vscode"] } }`
- **`url.parse()` DeprecationWarning** from node: comes from the editor's
  own CLI, harmless.

## Step 5: Onboarding (local vs connected)

When you run the installer from an agent session, stdin is usually not a
TTY, so the interactive onboarding at the end skips itself. Finish it
explicitly:

- **Local-only** (no account, nothing uploaded; attribution lives in Git
  notes under `refs/notes/ai`):

  ```bash
  autter onboard --local
  ```

- **Connect to the platform** (org dashboards, prompt search): the browser
  login flow needs the user, so ask them to run this themselves in their
  terminal:

  ```bash
  autter onboard --connect
  ```

  Headless / no browser: they can create a Personal Access Token in the
  Autter web app (**Org Settings → Access Tokens**) and run
  `autter login --token <token>` — the user should paste the token into
  their own terminal. **Never ask for the token in chat and never write it
  into files or shell history you control.**

Verify with `autter whoami` (connected) or `autter debug` (either mode).

## Step 6: Confirm it works

No workflow change is needed — the user commits as usual and Autter attaches
authorship metadata automatically. To prove the install end-to-end, make any
agent-authored commit in a repo and run:

```bash
autter blame <changed-file>
autter stats
```

## Troubleshooting quick reference

| Symptom | Cause | Fix |
| --- | --- | --- |
| `autter: command not found` after install | current shell predates PATH edit | open a new terminal, or `export PATH="$HOME/.autter/bin:$PATH"` |
| Literal `-e` in installer output | script was piped to `sh` on an older release | cosmetic; re-run with `| bash` if anything else misbehaved |
| Repeated red "Extension … not found" | extension lives on Open VSX, not MS Marketplace | ignore if the `.vsix` fallback line succeeded (older CLI noise) |
| Extension install failed outright | open-vsx.org unreachable (proxy/firewall) | manual `.vsix` download + `code --install-extension` |
| Daemon lock errors | installed with sudo/root | `sudo chown -R "$USER" ~/.autter`, reinstall as the normal user |
| Hooks missing in one editor | editor was open during install | close and reopen the editor, re-run `autter install-hooks` |
