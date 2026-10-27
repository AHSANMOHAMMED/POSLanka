# skyERPOS print agent - one-command installer for Windows (PowerShell 5.1+, no admin needed).
#
#   irm https://<your-app>/print-agent/install.ps1 | iex
#   irm https://<your-app>/print-agent/uninstall.ps1 | iex      (or: .\install.ps1 -Uninstall)
#
# Installs the agent to %LOCALAPPDATA%\skyERPOS\print-agent, starts it hidden at
# every logon (Startup folder shortcut) and starts it now. Installs Node.js LTS
# when missing (winget; else the official MSI when running as administrator;
# else the portable Node.js zip into %LOCALAPPDATA%\skyERPOS\node). Re-run to update.

$SkyerposUninstall = $false # uninstall.ps1 is served with $true here
if ($args -contains '-Uninstall') { $SkyerposUninstall = $true }

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  $Origin = '__SKYERPOS_ORIGIN__'
  if ($env:SKYERPOS_ORIGIN) { $Origin = $env:SKYERPOS_ORIGIN }
  $Origin = $Origin.TrimEnd('/')
  $Uninstall = $SkyerposUninstall -or ($env:SKYERPOS_PRINT_AGENT_UNINSTALL -eq '1')

  $Base = Join-Path $env:LOCALAPPDATA 'skyERPOS'
  $Dir = Join-Path $Base 'print-agent'
  $NodeDir = Join-Path $Base 'node'
  $Vbs = Join-Path $Dir 'start-hidden.vbs'
  $Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'skyERPOS print agent.lnk'
  $Health = 'http://127.0.0.1:9123/health'

  function Say([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
  function Fail([string]$m) { Write-Host "Error: $m" -ForegroundColor Red; throw $m }

  # Download with fallbacks: Invoke-WebRequest can fail on old TLS defaults, proxies or a missing
  # IE engine, so try the curl.exe built into Windows 10/11, then BITS, before giving up.
  function Get-File([string]$url, [string]$out) {
    $errs = @()
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out; if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) { return } } catch { $errs += "Invoke-WebRequest: $($_.Exception.Message)" }
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path $curl) {
      # Windows PowerShell 5.1 turns a native program's stderr into a terminating error under 'Stop'
      $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      try { & $curl -fsSL --retry 3 -o $out $url 2>&1 | Out-Null } catch { }
      $ErrorActionPreference = $prev
      if ($LASTEXITCODE -eq 0 -and (Test-Path $out) -and (Get-Item $out).Length -gt 0) { return }
      $errs += "curl.exe exit $LASTEXITCODE"
    }
    try { Start-BitsTransfer -Source $url -Destination $out -ErrorAction Stop; if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) { return } } catch { $errs += "BITS: $($_.Exception.Message)" }
    Fail ("Could not download $url (" + ($errs -join '; ') + '). Check the internet connection, proxy or antivirus and run the command again.')
  }

  function Stop-Agent {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*skyERPOS\print-agent\index.mjs*' })
    foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { } }
    if ($procs.Count -gt 0) { Start-Sleep -Seconds 1 }
  }

  if ($Uninstall) {
    Say 'Removing the skyERPOS print agent'
    Stop-Agent
    if (Test-Path $Shortcut) { Remove-Item $Shortcut -Force }
    if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
    Write-Host "Done. (A portable Node.js in $NodeDir, if any, was left in place.)" -ForegroundColor Green
    return
  }

  if ($Origin -notmatch '^https?://[A-Za-z0-9.\-]+(:\d+)?$') {
    Fail "Unknown app address '$Origin'. Run the command copied from the Print Labels page."
  }

  # ------------------------------------------------------------ Node.js 20+
  function Test-Node([string]$exe) {
    if (-not $exe -or -not (Test-Path $exe)) { return $false }
    try { $major = [int](& $exe -p "process.versions.node.split('.')[0]") } catch { return $false }
    return $major -ge 20
  }
  function Find-Node {
    $candidates = @(
      (Join-Path $NodeDir 'node.exe'),
      (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates = @($cmd.Source) + $candidates }
    foreach ($c in $candidates) { if (Test-Node $c) { return $c } }
    return $null
  }
  function Update-PathEnv {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  }

  $Node = Find-Node
  if (-not $Node) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $ver = 'v22.12.0'
    try {
      $lts = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1
      if ($lts -and $lts.version -match '^v\d+\.\d+\.\d+$') { $ver = $lts.version }
    } catch { }

    if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
      Say 'Node.js 20+ not found - installing Node.js LTS with winget (Windows may ask for permission)'
      try {
        & winget.exe install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
      } catch { }
      Update-PathEnv
      $Node = Find-Node
    }

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $Node -and $isAdmin) {
      Say "Installing Node.js $ver (official MSI from nodejs.org)"
      $msi = Join-Path $env:TEMP "node-$ver-$arch.msi"
      Get-File "https://nodejs.org/dist/$ver/node-$ver-$arch.msi" $msi
      Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait
      Remove-Item $msi -Force -ErrorAction SilentlyContinue
      Update-PathEnv
      $Node = Find-Node
    }

    if (-not $Node) {
      if (-not $isAdmin) { Say 'Not running as administrator: using the portable Node.js (no admin needed)' }
      Say "Downloading Node.js $ver into $NodeDir"
      $zip = Join-Path $env:TEMP "node-$ver-win-$arch.zip"
      $unz = Join-Path $env:TEMP "node-$ver-win-$arch"
      Get-File "https://nodejs.org/dist/$ver/node-$ver-win-$arch.zip" $zip
      if (Test-Path $unz) { Remove-Item $unz -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $unz -Force
      if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
      New-Item -ItemType Directory -Force -Path $Base | Out-Null
      Move-Item (Join-Path $unz "node-$ver-win-$arch") $NodeDir
      Remove-Item $zip, $unz -Recurse -Force -ErrorAction SilentlyContinue
      $Node = Find-Node
    }
    if (-not $Node) { Fail 'Node.js could not be installed. Install the LTS version from https://nodejs.org and run this command again.' }
  }
  Say "Using Node.js $(& $Node -v) ($Node)"

  # ------------------------------------------------------------ agent files
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Stop-Agent
  Say "Downloading the print agent from $Origin"
  $tmp = Join-Path $Dir 'index.new.mjs'
  Get-File "$Origin/print-agent/index.mjs" $tmp
  & $Node --check $tmp
  if ($LASTEXITCODE -ne 0) { Fail 'The downloaded agent is damaged; run the command again.' }
  Move-Item $tmp (Join-Path $Dir 'index.mjs') -Force
  & $Node (Join-Path $Dir 'index.mjs') --allow-origin $Origin | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'Could not write printers.json.' }

  # Hidden launcher (no console window); output goes to agent.log.
  $log = Join-Path $Dir 'agent.log'
  $agent = Join-Path $Dir 'index.mjs'
  $q = '""'
  $vbsText = @(
    'Set sh = CreateObject("WScript.Shell")',
    "sh.CurrentDirectory = `"$Dir`"",
    "sh.Run `"cmd /c $q$q$Node$q $q$agent$q >> $q$log$q 2>&1$q`", 0, False"
  ) -join "`r`n"
  Set-Content -Path $Vbs -Value $vbsText -Encoding Unicode

  # ------------------------------------------------------------ autostart at logon
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut($Shortcut)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $lnk.Arguments = "`"$Vbs`""
  $lnk.WorkingDirectory = $Dir
  $lnk.Description = 'skyERPOS print agent (label and receipt printing)'
  $lnk.Save()

  # ------------------------------------------------------------ start + health check
  Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList "`"$Vbs`"" -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { $h = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 $Health; $ok = [bool]$h.ok } catch { }
  }
  if ($ok) {
    Write-Host ''
    Write-Host "The skyERPOS print agent $($h.version) is running ($Health) and starts with Windows." -ForegroundColor Green
    Write-Host 'Go back to the Print Labels page in the browser and press Retry.'
    Write-Host "Files: $Dir    Uninstall: irm $Origin/print-agent/uninstall.ps1 | iex"
  } else {
    Fail "The agent did not answer on $Health. See $log (another program may be using port 9123)."
  }
}
