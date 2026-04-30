param()

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[hooks] Git n'est pas installe ou non disponible dans le PATH."
    exit 1
}

$repoRoot = (cmd /c "git rev-parse --show-toplevel 2>NUL")
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    Write-Host "[hooks] Ce dossier n'est pas un repository Git. Lance d'abord: git init (ou ouvre le bon repo)."
    exit 1
}

Set-Location -LiteralPath $repoRoot

$hooksPath = Join-Path $repoRoot ".githooks"
if (-not (Test-Path -LiteralPath $hooksPath)) {
    Write-Host "[hooks] Dossier .githooks introuvable dans le repo."
    exit 1
}

git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    Write-Host "[hooks] Impossible de configurer core.hooksPath."
    exit 1
}

Write-Host "[hooks] core.hooksPath=.githooks configure."
Write-Host "[hooks] Hook actif: .githooks/pre-commit"
Write-Host "[hooks] Test rapide: git commit --allow-empty -m `"test hooks`""
