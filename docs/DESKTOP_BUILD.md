# Windows Desktop Build

The desktop distribution is a single console-mode `ERPFormatter.exe`. The target user does not
need Python, Node.js, pip packages, or an installer. The executable starts a loopback-only local
server and opens the app in the default browser.

## Build

Build on Windows x64 with Python and Node.js installed:

```powershell
.\scripts\build_desktop.ps1
```

The script installs locked frontend dependencies in an isolated `.desktop-build/` staging area,
installs the backend and PyInstaller build requirements, exports the static frontend, and packages
everything into:

```text
dist\ERPFormatter.exe
```

For repeat builds after dependencies are already installed:

```powershell
.\scripts\build_desktop.ps1 -SkipInstall
```

PyInstaller builds for the platform and architecture on which it runs. A Windows x64 build creates
a Windows x64 executable. Windows ARM, macOS, and Linux require separate builds on their respective
platforms and architectures.

## First Run

An unsigned executable can trigger Windows SmartScreen. If Windows displays **Windows protected
your PC**, select **More info**, verify that the file came from the expected source, and select
**Run anyway**. Antivirus products can also false-positive on unsigned PyInstaller one-file
executables.

The reliable way to remove or substantially reduce this warning is to sign the executable with a
trusted Windows code-signing certificate. Code signing is optional and certificates normally have
an annual cost.

The app opens in the default browser. Keep the console window open while using it; close that
window or press Ctrl+C to stop the app. SQLite, uploaded files, generated files, and the persistent
secret are stored under:

```text
%LOCALAPPDATA%\ERPFormatter\
```

## Release Verification

Before distribution, copy only `dist\ERPFormatter.exe` to a clean Windows x64 machine or VM with
no Python or Node.js installed. Double-click it and verify the home page, upload, preview, download,
recent uploads, reprocess, delete, settings, relaunch persistence, loopback-only binding, and clean
shutdown.
