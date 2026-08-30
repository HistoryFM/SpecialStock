$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot

function Read-PlainTextSecret([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is missing. Ask Codex to install Node.js 24, then run this script again."
}

$nodeVersion = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -ne 24) {
  throw "SpecialStock requires Node.js 24.x; found $nodeVersion. Ask Codex to install or activate Node.js 24."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm is missing. Ask Codex to install pnpm 11.19.0, then run this script again."
}

Write-Host "Installing locked dependencies..."
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

if (Test-Path ".env.local") {
  Write-Host "Using the supplied private .env.local file. Its values will not be displayed or rewritten."
}
else {
  $password = $null
  $openRouterApiKey = $null
  $chartImgApiKey = $null
  try {
    $password = Read-PlainTextSecret "Local SpecialStock password (12+ characters)"
    $openRouterApiKey = Read-PlainTextSecret "OpenRouter API key"
    $chartImgApiKey = Read-PlainTextSecret "Chart-Img API key"

    if ([string]::IsNullOrWhiteSpace($openRouterApiKey)) { throw "OpenRouter API key is required." }
    if ([string]::IsNullOrWhiteSpace($chartImgApiKey)) { throw "Chart-Img API key is required." }

    $payload = @{
      password = $password
      openRouterApiKey = $openRouterApiKey
      chartImgApiKey = $chartImgApiKey
    } | ConvertTo-Json -Compress

    $payload | & node scripts/setup-local.mjs --json-stdin
    if ($LASTEXITCODE -ne 0) { throw "Local environment setup failed." }
  }
  finally {
    $password = $null
    $openRouterApiKey = $null
    $chartImgApiKey = $null
    $payload = $null
  }
}

Write-Host "Preparing the embedded database..."
& pnpm db:migrate
if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }

Write-Host "Validating and building SpecialStock. No live analysis will be triggered..."
& pnpm validate
if ($LASTEXITCODE -ne 0) { throw "Validation failed. Ask Codex to diagnose the output above." }

Write-Host ""
Write-Host "SpecialStock is ready. Double-click Start-SpecialStock.cmd to run it."
