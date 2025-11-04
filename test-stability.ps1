# Tell Me Search Stability Test
# Runs integration tests multiple times to verify stability

$iterations = 20
$passed = 0
$failed = 0

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host "  Tell Me Search Stability Test ($iterations iterations)" -ForegroundColor Blue
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host ""

for ($i = 1; $i -le $iterations; $i++) {
    Write-Host "[$i/$iterations] Running test..." -NoNewline

    $result = & npm run test:mcp:client 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-Host " ✓ PASS" -ForegroundColor Green
        $passed++
    } else {
        Write-Host " ✗ FAIL" -ForegroundColor Red
        $failed++
        Write-Host "Exit code: $exitCode" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host "  Results" -ForegroundColor Blue
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Blue
Write-Host ""
Write-Host "✓ Passed: $passed/$iterations" -ForegroundColor Green
if ($failed -gt 0) {
    Write-Host "✗ Failed: $failed/$iterations" -ForegroundColor Red
    $rate = [math]::Round(($passed / $iterations) * 100, 1)
    Write-Host "Success rate: $rate%" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "100% success rate! ✨" -ForegroundColor Green
    exit 0
}
