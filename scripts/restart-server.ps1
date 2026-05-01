$ErrorActionPreference = "Stop"

$port = 4000
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($listener) {
  $processId = $listener.OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
  $name = $proc.Name
  $commandLine = $proc.CommandLine

  $isExpectedProcess = $name -match "^(node|node\.exe)$" -and $commandLine -match "server[\\/]index\.js"

  if ($isExpectedProcess) {
    Write-Output "Stopping existing API process on port $port (PID=$processId)..."
    Stop-Process -Id $processId -Force
  }
  else {
    Write-Warning "Port $port is in use by an unexpected process."
    Write-Warning "Process: $name"
    Write-Warning "Command: $commandLine"
    Write-Warning "Refusing to terminate automatically."
    exit 1
  }
}

Write-Output "Starting Offshore League API..."
node --env-file=.env server/index.js
