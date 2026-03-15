Param(
  [string]$ServerIp = "185.219.7.21",
  [string]$ServerUser = "root",
  [string]$AppDir = "/opt/selective-conference",
  [string]$RepoUrl = "",
  [string]$GitHubToken = "",
  [switch]$ForceReclone,
  [string]$AdminUsername = "admin",
  [string]$AdminPassword = "change_me_admin_password",
  [string]$LiveKitApiKey = "APINinpPDDpi7VR",
  [Parameter(Mandatory = $true)]
  [string]$LiveKitApiSecret,
  [string]$AllowedOrigins = "*",
  [string]$PublicWebBaseUrl = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-RemoteBash {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptBody
  )
  $target = "${ServerUser}@${ServerIp}"
  $normalized = $ScriptBody -replace "`r`n", "`n" -replace "`r", "`n"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $b64 = [Convert]::ToBase64String($bytes)
  $remoteCmd = "echo '$b64' | base64 -d | bash -s"
  ssh $target $remoteCmd
  if ($LASTEXITCODE -ne 0) {
    throw "Remote command failed with exit code $LASTEXITCODE"
  }
}

Require-Command ssh

if ($PublicWebBaseUrl -eq "") {
  $PublicWebBaseUrl = "http://${ServerIp}:8080"
}

$effectiveRepoUrl = $RepoUrl
if ($RepoUrl -ne "" -and $GitHubToken -ne "" -and $RepoUrl.StartsWith("https://github.com/")) {
  $effectiveRepoUrl = $RepoUrl.Replace("https://", "https://x-access-token:$GitHubToken@")
}

Write-Host "[1/6] Preparing Debian server packages and Docker..."
$remoteBootstrap = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt update
apt install -y ca-certificates curl gnupg lsb-release git ufw

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

mkdir -p '__APP_DIR__'
'@
$remoteBootstrap = $remoteBootstrap.Replace('__APP_DIR__', $AppDir)
Invoke-RemoteBash -ScriptBody $remoteBootstrap

if ($RepoUrl -ne "") {
  Write-Host "[2/6] Cloning or updating repository..."
  $repoCmd = @'
set -euo pipefail
mkdir -p '__APP_DIR__'
cd '__APP_DIR__'

if [ -d .git ]; then
  git remote set-url origin '__REPO_URL__' || true
  git fetch --all
  git pull --ff-only || true
else
  if [ -n "$(ls -A . 2>/dev/null)" ]; then
    __FORCE_BLOCK__
  fi
  git clone '__REPO_URL__' .
fi
'@
  $forceBlock = "echo 'Directory is not empty and is not a git repository: __APP_DIR__' >&2; exit 1"
  if ($ForceReclone) {
    $forceBlock = "find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
  }
  $repoCmd = $repoCmd.Replace('__APP_DIR__', $AppDir).Replace('__REPO_URL__', $effectiveRepoUrl).Replace('__FORCE_BLOCK__', $forceBlock.Replace('__APP_DIR__', $AppDir))
  Invoke-RemoteBash -ScriptBody $repoCmd
} else {
  Write-Host "[2/6] Repository URL not provided. Make sure project files already exist at $AppDir"
}

Write-Host "[3/6] Writing .env configuration..."
$envContent = @"
LIVEKIT_API_KEY=$LiveKitApiKey
LIVEKIT_API_SECRET=$LiveKitApiSecret
ADMIN_USERNAME=$AdminUsername
ADMIN_PASSWORD=$AdminPassword
ALLOWED_ORIGINS=$AllowedOrigins
PUBLIC_WEB_BASE_URL=$PublicWebBaseUrl
"@
$envWriteCmd = @'
set -euo pipefail
cat > '__APP_DIR__/.env' <<'ENVFILE'
__ENV_CONTENT__
ENVFILE
chmod 600 '__APP_DIR__/.env'
'@
$envWriteCmd = $envWriteCmd.Replace('__APP_DIR__', $AppDir).Replace('__ENV_CONTENT__', $envContent.Trim())
Invoke-RemoteBash -ScriptBody $envWriteCmd

Write-Host "[4/6] Opening firewall ports (22, 8000, 8080)..."
$fwCmd = @'
set -euo pipefail
ufw allow 22/tcp || true
ufw allow 8000/tcp || true
ufw allow 8080/tcp || true
ufw --force enable || true
'@
Invoke-RemoteBash -ScriptBody $fwCmd

Write-Host "[5/6] Building and starting services..."
$upCmd = @'
set -euo pipefail
cd '__APP_DIR__'
if [ ! -f docker-compose.yml ] && [ ! -f compose.yaml ] && [ ! -f compose.yml ]; then
  echo 'Compose file not found in app directory' >&2
  ls -la
  exit 1
fi
docker compose up -d --build
'@
$upCmd = $upCmd.Replace('__APP_DIR__', $AppDir)
Invoke-RemoteBash -ScriptBody $upCmd

Write-Host "[6/6] Verifying deployment..."
$checkCmd = @'
set -euo pipefail
cd '__APP_DIR__'
if [ ! -f docker-compose.yml ] && [ ! -f compose.yaml ] && [ ! -f compose.yml ]; then
  echo 'Compose file not found in app directory' >&2
  ls -la
  exit 1
fi
docker compose ps
curl -fsS http://127.0.0.1:8000/health
'@
$checkCmd = $checkCmd.Replace('__APP_DIR__', $AppDir)
Invoke-RemoteBash -ScriptBody $checkCmd

Write-Host "Done."
Write-Host "Web UI: http://${ServerIp}:8080"
Write-Host "API:    http://${ServerIp}:8000"
