# PowerShell script to fix remaining logger errors
# Fixes pino logger format issues (first param must be object)

$rootPath = "C:\bc4ubuntu\Decompiled\bc-poc\src"

# Files with logger errors
$files = @(
    "BCWebSocketClient.ts",
    "parsers\page-metadata-parser.ts",
    "test-mcp-server-real.ts"
)

function Fix-LoggerErrors {
    param($filePath)

    $fullPath = Join-Path $rootPath $filePath

    if (!(Test-Path $fullPath)) {
        Write-Host "File not found: $fullPath" -ForegroundColor Yellow
        return
    }

    Write-Host "Fixing logger errors in $filePath..." -ForegroundColor Cyan

    $content = Get-Content $fullPath -Raw
    $originalContent = $content

    # Fix patterns where logger methods have two parameters with first being a string
    # Pattern: logger.method('string', variable) -> logger.method({ variable }, 'string')

    # Fix logger.error patterns
    $content = $content -replace "logger\.error\('([^']+):', ([^)]+)\)", 'logger.error({ $2 }, ''$1'')'
    $content = $content -replace 'logger\.error\("([^"]+):", ([^)]+)\)', 'logger.error({ $2 }, "$1")'

    # Fix logger.warn patterns
    $content = $content -replace "logger\.warn\('([^']+):', ([^)]+)\)", 'logger.warn({ $2 }, ''$1'')'
    $content = $content -replace 'logger\.warn\("([^"]+):", ([^)]+)\)', 'logger.warn({ $2 }, "$1")'

    # Fix logger.info patterns with two parameters (second is a variable)
    $content = $content -replace "logger\.info\('([^']+):', ([^)]+)\)", 'logger.info({ $2 }, ''$1'')'
    $content = $content -replace 'logger\.info\("([^"]+):", ([^)]+)\)', 'logger.info({ $2 }, "$1")'

    # Fix specific patterns in page-metadata-parser
    $content = $content -replace "logger\.info\('\[PageMetadataParser\] Found (\d+) handlers', handlers\.length\)", 'logger.info({ count: handlers.length }, "[PageMetadataParser] Found handlers")'
    $content = $content -replace "logger\.info\('\[PageMetadataParser\] Extracted formId:', formId\)", 'logger.info({ formId }, "[PageMetadataParser] Extracted formId")'
    $content = $content -replace "logger\.info\('\[PageMetadataParser\] Looking for LogicalForm in handler', handler\.handlerType\)", 'logger.info({ handlerType: handler.handlerType }, "[PageMetadataParser] Looking for LogicalForm in handler")'

    # Write back if changed
    if ($content -ne $originalContent) {
        Set-Content -Path $fullPath -Value $content -NoNewline
        Write-Host "  ✓ Fixed logger errors" -ForegroundColor Green
    } else {
        Write-Host "  No changes needed" -ForegroundColor Gray
    }
}

# Process all files
foreach ($file in $files) {
    Fix-LoggerErrors $file
}

Write-Host "`n✅ Logger error fixes complete!" -ForegroundColor Green