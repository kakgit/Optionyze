$f = 'd:/NodeJS/Optionyze/src/views/crypto-scalper.ejs'
$lines = Get-Content $f
# 0-indexed ranges: renko block 984-1108, EMA block 1119-1184
$removeRanges = @(
    @{Start=984; End=1108},
    @{Start=1119; End=1184}
)
$keep = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Count; $i++) {
    $remove = $false
    foreach ($range in $removeRanges) {
        if ($i -ge $range.Start -and $i -le $range.End) { $remove = $true; break }
    }
    if (!$remove) { $keep.Add($lines[$i]) }
}
[System.IO.File]::WriteAllLines($f, $keep)
Write-Host "Removed Delta Renko-Style Feed and EMA Trigger sections from crypto-scalper.ejs"
