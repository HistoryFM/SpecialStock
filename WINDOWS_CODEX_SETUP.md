# SpecialStock: Windows + Codex setup

This guide is for the Windows laptop that runs SpecialStock locally. Source updates come from the public repository at `https://github.com/HistoryFM/SpecialStock`; credentials, the embedded database, and chart images remain private on the laptop.

Never commit, push, upload, paste, or display `.env.local` or `.data/`. The public repository does not contain provider keys or a working login credential.

## First transition from the ZIP copy

The existing ZIP-based folder is not a Git checkout, so it cannot receive `git pull`. Use one clean transition:

1. Stop SpecialStock and confirm the command window has closed.
2. Keep the old folder as a private backup.
3. Install the ChatGPT/Codex Windows desktop app if needed.
4. Open a normal writable parent folder such as `C:\Users\<your-name>\Projects` in Codex.
5. Give Codex the prompt below. Codex will inspect the machine, ask before installing missing tools, clone the repository into a new folder, and privately copy `.env.local` and `.data` from the old folder.

```text
Set up the public SpecialStock repository on this Windows laptop. The old private copy is in <paste the old folder path here>. First read https://github.com/HistoryFM/SpecialStock/blob/main/AGENTS.md and WINDOWS_CODEX_SETUP.md. Use Windows-native PowerShell, not WSL or Docker. Stop if SpecialStock is still running. Check for Git for Windows, Node.js 24.x, and pnpm 11.19.0; explain and ask before installing anything missing. Clone https://github.com/HistoryFM/SpecialStock.git into a new sibling folder. Copy the old .env.local and the entire old .data folder into the clone without displaying, logging, uploading, or rewriting their contents. Never add either path to Git. Run Setup-Windows.ps1, fix only genuine setup problems, and run the documented validation. Do not trigger a live stock analysis because it consumes provider quota. Start the app, confirm http://127.0.0.1:3000 loads, and tell me how to stop and restart it. Keep the old folder until I confirm the new copy works.
```

Do not copy `.data/` while either application copy is running. The one-time database migration enables automatic scanning for every stock currently in the watchlist; individual stocks can be turned off afterward.

## First-time clone without an older copy

Use this when there is no private folder to preserve:

```text
Clone https://github.com/HistoryFM/SpecialStock.git and set it up on this Windows laptop. Read AGENTS.md and WINDOWS_CODEX_SETUP.md completely. Use Windows-native PowerShell, not WSL or Docker. Check for Git for Windows, Node.js 24.x, and pnpm 11.19.0, and ask before installing anything missing. Run Setup-Windows.ps1. Enter secrets only through the script's hidden PowerShell prompts; never ask me to paste keys into chat and never display or upload .env.local. Run the documented validation without triggering live Chart-Img, OpenRouter, Gemini, or Alpaca calls. Start the app and confirm http://127.0.0.1:3000 loads.
```

The setup script prompts privately for the local password, OpenRouter key, and Chart-Img key when `.env.local` does not exist. Alpaca remains optional and can be added privately afterward.

## Receiving future updates

Stop the app before updating. Then open the cloned `SpecialStock` folder in Codex and use:

```text
Read AGENTS.md and WINDOWS_CODEX_SETUP.md. Update this existing SpecialStock clone from origin/main. Use Windows-native PowerShell. First confirm the app is stopped and verify that .env.local and .data exist locally and are ignored by Git without printing their contents. Preserve both paths exactly. Inspect git status and do not discard any local source edits without asking. Pull with git pull --ff-only. Run Setup-Windows.ps1 so locked dependencies, database migrations, tests, and the production build are current. Do not make live provider calls. Start the app, confirm http://127.0.0.1:3000 loads, and summarize the update.
```

If `git pull --ff-only` cannot proceed because source files were edited locally, Codex must show a concise source-only diff and ask how to preserve those edits. It must never solve the problem by deleting or replacing `.env.local` or `.data/`.

## What `Setup-Windows.ps1` does

1. Confirms Node.js 24 and pnpm 11.19 are available.
2. Installs exactly the dependencies in `pnpm-lock.yaml`.
3. Uses an existing `.env.local` without displaying or rewriting it, or creates one through hidden prompts.
4. Applies checked-in migrations to the embedded PGlite database under `.data/`.
5. Runs the repository-secret check, lint, TypeScript checks, unit tests, migration checks, a production build, and the browser-bundle secret check.
6. Does not call Chart-Img, OpenRouter, Gemini, or Alpaca.

If Windows blocks the setup script, Codex can run this project-scoped command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup-Windows.ps1
```

The bypass applies only to that invocation.

## Starting, automatic scanning, and stopping

Double-click `Start-SpecialStock.cmd` after setup succeeds.

- A command window remains open while the app is running.
- The browser opens at `http://127.0.0.1:3000`.
- Keep the command window, authenticated dashboard tab, laptop, and internet connection active for automatic scans.
- On normal US sessions, enabled stocks run at approximately 9:35:10 AM, 9:40:10 AM, and every five minutes through 3:55:10 PM Eastern. There is no 4:00 PM automatic run.
- Early closes and market holidays follow the configured exchange calendar.
- Manual **Run now** remains available even when auto is off or the market is closed.
- Press `Ctrl+C` in the command window, or close that window, to stop the app.

The watchlist distinguishes the latest completed result, a new run in progress, and a failed latest attempt that is showing an older valid result. Every row also shows `Auto on` or `Auto off`.

## Giving product feedback

Capture the symbol, approximate Eastern time, a screenshot, what appeared correct, what was confusing, and the expected behavior. Then use a prompt such as:

```text
Read AGENTS.md and inspect this SpecialStock project. I found a problem while analyzing NVDA at approximately 10:35 AM Eastern. Diagnose the cause first and explain the proposed fix before changing code. Preserve .env.local and .data, do not run a live provider analysis without asking, and run the relevant mocked tests after the change.
```

Local source edits will make the next `git pull --ff-only` require a deliberate merge or a new branch. Codex must preserve and explain those edits rather than silently overwriting them.

## Common problems

### `git`, `node`, or `pnpm` is not recognized

Restart Codex or open a new PowerShell terminal after installation. Ask Codex to verify versions before reinstalling. Git installation is needed for clone/pull; the application itself requires Node 24.x and pnpm 11.19.0.

### Port 3000 is already in use

Ask Codex to identify the exact process listening on port 3000 and stop only that process. Do not broadly terminate every Node process.

### The login password fails

Confirm that the intended `.env.local` was copied to the clone. Do not print `APP_PASSWORD_HASH`. If the password must be reset, use the hidden local setup workflow and rebuild.

### Chart-Img or Gemini fails

Do not paste keys into chat. Report only the error category shown by the UI. Typical categories are invalid credentials, unsupported symbol, quota/rate limit, chart capture failure, unreadable image, or Gemini failure.

### Automatic scans do not run

Confirm that the row shows `Auto on`, the dashboard is logged in and open, the laptop is awake and online, and the time is between 9:35 AM and 3:55 PM Eastern on a regular trading day. Run `Setup-Windows.ps1` after pulling so the auto-enable migration and production build are current.

## Private local files

- `.env.local`: provider credentials, Auth.js secret, and password hash.
- `.data/specialstock/`: application database and settings.
- `.data/chart-artifacts/`: exact chart images sent to Gemini.

These paths are ignored by Git. Screenshots of the decision UI are usually sufficient for feedback, but review them before sharing because they contain symbols, prices, and analysis history.
