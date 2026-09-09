# Prueft, ob Hiltons Zimmerabfrage ohne Cookies durchgeht.
# Aufruf:  .\test-hilton.ps1            (Hilton Frankfurt City Centre)
#          .\test-hilton.ps1 STRPKGI    (anderes Haus)

param([string]$Ctyhocn = "FRAHITW")

$query = @'
query hotel_roomTypes($ctyhocn: String!, $language: String!) {
  hotel(ctyhocn: $ctyhocn, language: $language) {
    roomTypeCategories { category roomTypes { roomTypeCode } }
    roomTypes {
      accommodationCode
      roomTypeCode
      roomTypeName @toTitleCase
      desc: customDescription
      highlights: features(first: 8) { name }
    }
  }
}
'@

$body = @{
  operationName = "hotel_roomTypes"
  query         = $query
  variables     = @{ ctyhocn = $Ctyhocn; language = "de" }
} | ConvertTo-Json -Depth 5 -Compress

$uri = "https://www.hilton.com/graphql/customer" +
       "?appName=dx-property-ui&appVersion=dx-property-ui%3A1024021" +
       "&operationName=hotel_roomTypes&originalOpName=getHotelRooms&bl=de&language=de"

$headers = @{
  "accept"          = "*/*"
  "accept-language" = "de,en-US;q=0.9,en;q=0.8"
  "dx-platform"     = "web"
  "origin"          = "https://www.hilton.com"
  "referer"         = "https://www.hilton.com/de/hotels/$($Ctyhocn.ToLower())/rooms/"
  "user-agent"      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}

Write-Host "Frage $Ctyhocn ab ..." -ForegroundColor Cyan

try {
  $res = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
           -ContentType "application/json" -Body $body -TimeoutSec 30
} catch {
  Write-Host "FEHLGESCHLAGEN: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Response) {
    Write-Host "Status: $([int]$_.Exception.Response.StatusCode)"
  }
  exit 1
}

if ($res.errors) {
  Write-Host "GraphQL-Fehler:" -ForegroundColor Yellow
  $res.errors | ForEach-Object { Write-Host "  $($_.message)" }
}

$zimmer = $res.data.hotel.roomTypes
if (-not $zimmer) { Write-Host "Keine Zimmer in der Antwort." -ForegroundColor Red; exit 1 }

Write-Host "$($zimmer.Count) Kategorien:" -ForegroundColor Green
$zimmer | ForEach-Object {
  "{0,-8} {1,-6} {2}" -f $_.roomTypeCode, $_.accommodationCode, $_.roomTypeName
}
