# OpsCLI

`opscli` installs and maintains OrgOps on a host. Most commands are deterministic and
safe to script; `chat` adds an optional agent that can diagnose and repair a host even
when the API or UI is down.

## Download

Every push to `main` publishes a release with self-contained binaries:
`opscli-linux`, `opscli-macos` and `opscli-windows`. Get them from
[GitHub Releases](https://github.com/camplight/orgops/releases).

On macOS, remove the Gatekeeper quarantine flag first:

```bash
xattr -d com.apple.quarantine ./opscli-macos
chmod +x ./opscli-macos
./opscli-macos
```

From a source checkout you can also run it with
`npm run --workspace @orgops/opscli start`.

## Install

```bash
opscli install --register-service --create-shortcut
```

What `install` does:

1. Clones OrgOps with git (or downloads a source archive with `--no-git`). If git is
   missing, it tries to install it.
2. Downloads a private Node.js toolchain to `~/.orgops/toolchains` (set
   `ORGOPS_OPSCLI_USE_SYSTEM_TOOLCHAIN=1` to use the system Node instead).
3. Runs `npm ci` and builds the UI assets for the selected components.
4. On first install, writes a working `.env` with a random master key, runner token and
   admin password. The generated admin credentials are printed **once**. Existing `.env`
   keys are never overwritten.
5. With `--register-service`, registers per-user services that start at login.

Choose components with `--components` (comma-separated: `api`, `runner`, `user-ui`,
`admin-ui`). Use `--yes` for non-interactive runs and `--json` for machine-readable
output (`{ ok, command, result | error }`).

## Everyday commands

| Command | Purpose |
| --- | --- |
| `opscli start` / `stop` / `restart` / `status` | Control components (through OS services when registered, PID files otherwise) |
| `opscli admin open` / `stop` / `status` | Shortcut for the admin UI |
| `opscli upgrade` | Back up data, update the code and restart components that were running |
| `opscli doctor` | Report host prerequisites |
| `opscli component add` / `remove` | Change installed components |
| `opscli service register` / `unregister` | Add or remove auto-start per component |
| `opscli service start` / `stop` / `restart` / `status` | Control registered OS services |
| `opscli shortcut create` | Desktop shortcut for the user UI or admin UI |
| `opscli uninstall` | Stop and remove; keeps `.env`, `.orgops-data`, `files`, backups unless `--purge-data` |
| `opscli chat [--goal "..."]` | Agentic chat mode |

Most commands accept `--dir <path>` to target a specific installation.

## Upgrades

`opscli upgrade` backs up `.orgops-data`, `files` and `.env`, stops the selected
components, updates and restarts the ones that were running. For git installs with local
changes it first creates an autosave commit, then rebases onto the requested ref
(`--ref`).

## Auto-start services

Services run as the current user, without visible windows:

| OS | Mechanism |
| --- | --- |
| macOS | LaunchAgent (`ProcessType=Background`) |
| Linux | systemd user service |
| Windows | Scheduled Task (`WindowStyle Hidden`) |

## Chat mode

```bash
opscli chat --goal "The runner on this host is offline, find out why"
```

`chat` is the only command that needs model credentials. If no key is configured it
asks you to choose OpenAI, Claude (Anthropic), OpenRouter, Mistral or Liquid AI and saves
the key to the local `.env`.
The model is set by `ORGOPS_OPSCLI_MODEL` (default `openai:gpt-5.2`). The agent can run
shell commands, ask for passwords and read the bundled OrgOps docs.

Press `Ctrl+C` once to interrupt the current run, twice quickly to exit.

See [Configuration](../reference/configuration.md#opscli) for all OpsCLI variables.
