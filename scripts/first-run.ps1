param(
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LaunchScript = Join-Path $ProjectRoot "scripts\launch.ps1"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$appPort = 3100
$envPath = Join-Path $ProjectRoot ".env"
if (Test-Path $envPath) {
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^PORT=(\d+)') { $appPort = [int]$matches[1] }
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Auto-Track POS - first-run setup"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(620, 470)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$heading = New-Object System.Windows.Forms.Label
$heading.Text = "Set up Auto-Track POS on this PC"
$heading.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$heading.AutoSize = $true
$heading.Location = New-Object System.Drawing.Point(24, 18)
$form.Controls.Add($heading)

$body = New-Object System.Windows.Forms.Label
$body.Text = @"
Auto-Track POS runs locally. The database stays on 127.0.0.1 and is never exposed to the network.

The two options below are optional and are created for your Windows user account only. You can remove either one later without touching shop data.
"@
$body.AutoSize = $false
$body.Size = New-Object System.Drawing.Size(572, 76)
$body.Location = New-Object System.Drawing.Point(24, 58)
$form.Controls.Add($body)

$shortcut = New-Object System.Windows.Forms.CheckBox
$shortcut.Text = "Create a desktop shortcut"
$shortcut.Checked = $true
$shortcut.AutoSize = $true
$shortcut.Location = New-Object System.Drawing.Point(24, 148)
$form.Controls.Add($shortcut)

$shortcutHelp = New-Object System.Windows.Forms.Label
$shortcutHelp.Text = "Adds an Auto-Track POS icon to your desktop. The shortcut starts the local database and server, then opens the POS in your browser. It contains no password or setup token."
$shortcutHelp.AutoSize = $false
$shortcutHelp.Size = New-Object System.Drawing.Size(548, 46)
$shortcutHelp.Location = New-Object System.Drawing.Point(44, 172)
$shortcutHelp.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($shortcutHelp)

$autoStart = New-Object System.Windows.Forms.CheckBox
$autoStart.Text = "Start Auto-Track POS automatically when I sign in to Windows"
$autoStart.Checked = $true
$autoStart.AutoSize = $true
$autoStart.Location = New-Object System.Drawing.Point(24, 236)
$form.Controls.Add($autoStart)

$autoStartHelp = New-Object System.Windows.Forms.Label
$autoStartHelp.Text = "Adds a hidden entry to your personal Startup folder. When you sign in, it starts the local MySQL server and the POS server in the background. This is a per-user login start, not a Windows service. It does not open a browser window."
$autoStartHelp.AutoSize = $false
$autoStartHelp.Size = New-Object System.Drawing.Size(548, 58)
$autoStartHelp.Location = New-Object System.Drawing.Point(44, 260)
$autoStartHelp.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($autoStartHelp)

$note = New-Object System.Windows.Forms.Label
$note.Text = "Continue starts the local database and server now and opens http://127.0.0.1:$appPort/"
$note.AutoSize = $false
$note.Size = New-Object System.Drawing.Size(548, 44)
$note.Location = New-Object System.Drawing.Point(24, 332)
$form.Controls.Add($note)

$start = New-Object System.Windows.Forms.Button
$start.Text = "Continue and start"
$start.DialogResult = [System.Windows.Forms.DialogResult]::OK
$start.Size = New-Object System.Drawing.Size(150, 34)
$start.Location = New-Object System.Drawing.Point(416, 404)
$form.Controls.Add($start)
$form.AcceptButton = $start

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.Size = New-Object System.Drawing.Size(90, 34)
$cancel.Location = New-Object System.Drawing.Point(310, 404)
$form.Controls.Add($cancel)
$form.CancelButton = $cancel

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$shellExe = (Get-Process -Id $PID).Path
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Auto-Track POS.lnk"
$startupShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Auto-Track POS.lnk"

function New-Shortcut([string]$Path, [string]$Arguments) {
  $shortcutObject = $shell.CreateShortcut($Path)
  $shortcutObject.TargetPath = $shellExe
  $shortcutObject.Arguments = $Arguments
  $shortcutObject.WorkingDirectory = $ProjectRoot
  $shortcutObject.IconLocation = "$shellExe,0"
  $shortcutObject.Description = "Start Auto-Track POS on this PC"
  $shortcutObject.Save()
}

try {
  if ($shortcut.Checked) {
    New-Shortcut $desktopShortcut "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LaunchScript`""
  } elseif (Test-Path $desktopShortcut) {
    Remove-Item $desktopShortcut -Force
  }

  if ($autoStart.Checked) {
    New-Shortcut $startupShortcut "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LaunchScript`" -Background"
  } elseif (Test-Path $startupShortcut) {
    Remove-Item $startupShortcut -Force
  }

  $marker = [ordered]@{
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
    desktopShortcut = [bool]$shortcut.Checked
    startWithWindows = [bool]$autoStart.Checked
    note = "Per-user shortcuts. Remove them from the desktop or Startup folder at any time."
  }
  $marker | ConvertTo-Json | Set-Content -Path (Join-Path $RuntimeDir "first-run-complete.json") -Encoding UTF8

  & $shellExe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $LaunchScript
  if ($LASTEXITCODE -ne 0) {
    throw "The launcher exited with code $LASTEXITCODE. See .runtime/logs/server.err.log."
  }
} catch {
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    "Auto-Track POS setup",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
