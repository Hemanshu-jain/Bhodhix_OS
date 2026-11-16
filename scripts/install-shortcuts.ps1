# Creates "Bhodhix OS" shortcuts on the Desktop and in the Start Menu.
# Re-run any time (it overwrites). Remove by deleting the two .lnk files.
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'electron\icon.ico'
if (-not (Test-Path $electron)) { throw "Electron not found at $electron - run 'npm install' in $root first." }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bhodhix OS.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Bhodhix OS.lnk')
)
foreach ($lnkPath in $targets) {
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = $electron
  $lnk.Arguments = "`"$root`""
  $lnk.WorkingDirectory = "$root"
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Bhodhix OS - Command Center'
  $lnk.Save()
  Write-Output "Created $lnkPath"
}
