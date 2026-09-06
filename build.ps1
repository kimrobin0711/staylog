# stayLOG veroeffentlichen: Version setzen und hochladen.
# Aufruf:  .\build.ps1
#
# Wichtig: Dateien werden ausdruecklich als UTF-8 ohne BOM gelesen und geschrieben.
# Get-Content/Set-Content wuerden unter Windows PowerShell die Umlaute zerstoeren.

$version = Get-Date -Format "yyyyMMdd-HHmmss"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = $PSScriptRoot

[System.IO.File]::WriteAllText(
  (Join-Path $root "public\version.json"),
  "{""version"": ""$version""}",
  $utf8
)

$pattern = '__VERSION__|\d{8}-\d{6}'
foreach ($name in @("public\index.html", "public\sw.js")) {
  $path = Join-Path $root $name
  $text = [System.IO.File]::ReadAllText($path, $utf8)
  $text = [regex]::Replace($text, $pattern, $version)
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}

npx wrangler pages deploy public --branch production --commit-dirty=true

Write-Host ""
Write-Host "Version $version ist online." -ForegroundColor Green
