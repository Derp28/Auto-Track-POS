# First-run setup and installer plan

**Requirement (2026-10-31):** when the app is launched for the first time, the user is
offered clear choices for:

- **Create a desktop shortcut**
- **Start Auto-Track POS automatically when Windows starts**

The setup must explain what each option does and must not silently change the machine.

## Status (2026-11-01)

The first-run launcher is implemented as **Option B**:

- `setup.cmd` opens `scripts/first-run.ps1`, a native PowerShell/WinForms dialog with
  two checked-by-default, clearly explained choices.
- `scripts/launch.ps1` starts portable MySQL when needed, applies migrations, starts
  Express, waits for the port, and opens `http://127.0.0.1:3100/`.
- The desktop shortcut and Startup-folder entry are per-user, contain no credentials, and
  require no administrator rights.
- Auto-start is a **login start**, not a Windows service. A future installer can promote
  the same scripts to services (Option A).

## Important limitation

A browser page cannot create a Windows desktop shortcut or register an auto-start entry by
itself. Those actions need a native component running with the user's permission. So the
checkboxes must live in one of these:

1. A Windows installer (EXE/MSI).
2. A first-run PowerShell/Node launcher that opens before the browser.
3. A small local helper started by the installer.

A checkbox inside the web UI alone cannot do it.

## Options

| Option | What the user experiences | Pros | Cons |
|---|---|---|---|
| **A. Windows installer** (Inno Setup, NSIS, or WiX) | Double-click setup → prerequisites check → install → checkboxes → Finish → browser opens | Most polished; can create services, shortcuts, firewall rule; clear instructions | Most work; bundling Node/MySQL raises size/licensing questions; needs code-signing eventually |
| **B. First-run launcher** (PowerShell or Node) | User runs `setup.ps1`/`launch.cmd` → prompts → checkboxes → app starts | Much simpler; no installer toolchain; easy to audit | Requires Node and MySQL to be installed first; less polished; execution-policy friction |
| **C. Web setup page** | Browser wizard after the app starts | Familiar UI; easy to style | Cannot create shortcuts/auto-start without a native helper; not sufficient alone |

**Recommendation for the first release:** **B, then A.**

- Start with a first-run launcher that assumes Node.js 24 and MySQL 8.4 LTS are installed.
- It asks the two questions, creates the per-user shortcut/Startup entry, starts MySQL and
  Express, and opens the app.
- Once the MySQL port is stable, wrap the same steps in an Inno Setup installer for a
  one-click experience.

## Proposed first-run flow

1. **Welcome** — explain that this sets up the local POS on this PC.
2. **Prerequisite check** - Node 24, MySQL 8.4, port 3307 free, loopback-only MySQL.
3. **Database setup** - create `autotrack_local`, migrator/app users, load time zones,
   run migrations (currently documented in `docs/INSTALL.md`; the launcher assumes
   `.env` is already configured).
4. **Administrator account** - create the first admin with the bootstrap token in the
   browser setup screen.
5. **Options** - checkboxes:
   - `[x] Create a desktop shortcut`
   - `[x] Start Auto-Track POS automatically when I sign in to Windows`
   - Short help text: the shortcut starts MySQL and Express and opens the POS; auto-start
     starts both in the background at sign-in.
6. **Install/start** - create the chosen per-user entries, start MySQL and Express.
7. **Finish** - open `http://127.0.0.1:3100/` and show the sign-in page.

## Auto-start semantics

Implemented behavior (per-user, no elevation):

- Auto-start controls **both** processes:
  - the portable `mysqld.exe` (or the installed MySQL service on a normal install)
  - `node server/index.js`
- Checked: `scripts/launch.ps1 -Background` is placed in
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
- Unchecked: the Startup entry is removed.
- The app waits for MySQL before starting Express and running migrations.
- The checkbox must not mean "start a terminal window at login."
- A future installer may replace this with `AutoTrackPOS` and `AutoTrackMySQL` Windows
  services; that requires administrator approval.

## Desktop shortcut semantics

- Target: the local launcher `powershell.exe -File <project>\scripts\launch.ps1`.
- The launcher opens `http://127.0.0.1:3100/` after the server is healthy.
- Name: `Auto-Track POS`.
- Icon: PowerShell icon for now; an app icon can be added later.
- Per-user shortcut by default; an all-users option can be added later.
- No credentials or tokens in the shortcut.

## Security rules

- MySQL stays on `127.0.0.1:3307`; no firewall rule for 3307.
- The app service runs with least privilege; database credentials live in a restricted
  `.env` or Windows credential store, never in the shortcut or logs.
- The installer/launcher must not disable Windows Firewall or antivirus.
- No public internet exposure.
- Uninstall must not delete the database or backups without a separate confirmation.

## Open decisions

1. **Installer or first-run script for the first release?** Resolved: first-run script
   (`setup.cmd`) first; installer later.
2. **Bundle Node/MySQL, or require prerequisites?** Resolved for now: require Node 24 and
   MySQL 8.4; the development copy uses a local portable MySQL.
3. **Per-user or all-users shortcut?** Resolved: per-user only.
4. **Shortcut target:** Resolved: launcher script, not a bare URL, so a stopped app is
   started before the browser opens.
5. **Branding/name:** `Auto-Track POS` for now.
6. **Uninstall/data retention:** keep data by default and require explicit deletion.
7. **Service promotion:** optional later; replace per-user Startup entries with Windows
   services only after an elevated install and restart test.
