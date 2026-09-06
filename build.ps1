# stayLOG veroeffentlichen: Version setzen und hochladen.
# Aufruf:  .\build.ps1

$version = Get-Date -Format "yyyyMMdd-HHmmss"

# Versionsdatei, die der Browser abfragt
"{""version"": ""$version""}" | Set-Content -NoNewline -Encoding UTF8 .\public\version.json

# Version in die Dateien schreiben. Ersetzt den Platzhalter beim ersten Mal
# und danach jeweils die vorherige Version.
$pattern = '__VERSION__|\d{8}-\d{6}'
foreach ($file in @(".\public\index.html", ".\public\sw.js")) {
  $text = Get-Content $file -Raw
  $text = [regex]::Replace($text, $pattern, $version)
  Set-Content -NoNewline -Encoding UTF8 $file $text
}

npx wrangler pages deploy public --branch production --commit-dirty=true

Write-Host ""
Write-Host "Version $version ist online." -ForegroundColor Green
