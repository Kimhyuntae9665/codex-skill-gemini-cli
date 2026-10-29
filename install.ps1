$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $HOME '.codex/skills/gemini-cli'
if (Test-Path -LiteralPath $target) { throw "Destination already exists: $target" }
New-Item -ItemType Directory -Path $target | Out-Null
foreach ($entry in @('SKILL.md','agents','scripts','references','LICENSE','README.md','PROVENANCE.md')) {
    Copy-Item -LiteralPath (Join-Path $source $entry) -Destination $target -Recurse
}
Write-Host "Installed at $target. Restart Codex or refresh skills."
