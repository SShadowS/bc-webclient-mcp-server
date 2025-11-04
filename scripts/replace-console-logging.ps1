# PowerShell script to replace console.* with logger calls
# Run with: pwsh scripts/replace-console-logging.ps1

$rootPath = "C:\bc4ubuntu\Decompiled\bc-poc\src"

# Files to update (grouped by type)
$toolFiles = @(
    "tools\read-page-data-tool.ts",
    "tools\find-record-tool.ts",
    "tools\update-record-tool.ts",
    "tools\create-record-tool.ts",
    "tools\filter-list-tool.ts",
    "tools\handle-dialog-tool.ts",
    "tools\write-page-data-tool.ts",
    "tools\update-field-tool.ts",
    "tools\execute-action-tool.ts",
    "tools\search-pages-tool.ts"
)

$parserFiles = @(
    "parsers\page-data-extractor.ts",
    "parsers\page-metadata-parser.ts",
    "parsers\handler-parser.ts"
)

$utilFiles = @(
    "util\loadform-helpers.ts"
)

$connectionFiles = @(
    "connection\connection-manager.ts",
    "connection\bc-page-connection.ts"
)

$clientFiles = @(
    "BCRawWebSocketClient.ts",
    "BCWebSocketClient.ts",
    "BCSignalRClient.ts",
    "auth.ts"
)

$entryFiles = @(
    "index.ts",
    "index-session.ts",
    "index-signalr.ts"
)

$testFiles = @(
    "test-mcp-server-real.ts"
)

function Update-ToolFile {
    param($filePath)

    $fullPath = Join-Path $rootPath $filePath

    if (!(Test-Path $fullPath)) {
        Write-Host "File not found: $fullPath" -ForegroundColor Yellow
        return
    }

    Write-Host "Processing $filePath..." -ForegroundColor Cyan

    $content = Get-Content $fullPath -Raw
    $originalContent = $content

    # Check if file has console usage
    if ($content -notmatch 'console\.(log|error|warn|debug|info)') {
        Write-Host "  No console calls found" -ForegroundColor Gray
        return
    }

    # Add logger import if not present
    if ($content -notmatch "from ['`"].*/logger") {
        $lastImport = [regex]::Match($content, "import[^;]+;(?![\s\S]*import[^;]+;)")
        if ($lastImport.Success) {
            $importStatement = "`nimport { createToolLogger } from '../core/logger.js';"
            $content = $content.Insert($lastImport.Index + $lastImport.Length, $importStatement)
        }
    }

    # Add logger creation at start of executeInternal if not present
    if (($filePath -match 'tools\\') -and ($content -notmatch 'const logger = createToolLogger')) {
        $executePattern = 'protected async executeInternal\([^)]*\)[^{]*{'
        $executeMatch = [regex]::Match($content, $executePattern)
        if ($executeMatch.Success) {
            $toolName = [regex]::Match($filePath, '([^\\]+)-tool\.ts$').Groups[1].Value
            $toolName = $toolName -replace '-', '_'
            $loggerLine = "`n    const logger = createToolLogger('$toolName', (input as any)?.pageContextId);"
            $content = $content.Insert($executeMatch.Index + $executeMatch.Length, $loggerLine)
        }
    }

    # Replace console.error calls with logger
    # Pattern 1: console.error(`[ToolName] message`)
    $content = $content -replace 'console\.error\(`\[[^\]]+\]\s*([^`]*)`', 'logger.info(`$1`'

    # Pattern 2: console.error('string') or console.error("string")
    $content = $content -replace 'console\.error\(([''"])([^''"`]*)\1', 'logger.error($1$2$1'

    # Pattern 3: Other console methods
    $content = $content -replace 'console\.log', 'logger.info'
    $content = $content -replace 'console\.warn', 'logger.warn'
    $content = $content -replace 'console\.debug', 'logger.debug'

    # Write back if changed
    if ($content -ne $originalContent) {
        Set-Content -Path $fullPath -Value $content -NoNewline
        Write-Host "  ✓ Updated" -ForegroundColor Green
    } else {
        Write-Host "  No changes needed" -ForegroundColor Gray
    }
}

function Update-NonToolFile {
    param($filePath)

    $fullPath = Join-Path $rootPath $filePath

    if (!(Test-Path $fullPath)) {
        Write-Host "File not found: $fullPath" -ForegroundColor Yellow
        return
    }

    Write-Host "Processing $filePath..." -ForegroundColor Cyan

    $content = Get-Content $fullPath -Raw
    $originalContent = $content

    # Check if file has console usage
    if ($content -notmatch 'console\.(log|error|warn|debug|info)') {
        Write-Host "  No console calls found" -ForegroundColor Gray
        return
    }

    # Add logger import if not present
    if ($content -notmatch "from ['`"].*/logger") {
        $lastImport = [regex]::Match($content, "import[^;]+;(?![\s\S]*import[^;]+;)")
        if ($lastImport.Success) {
            # Determine correct import path
            $depth = ($filePath.Split('\').Count - 1)
            $importPath = if ($depth -eq 0) { './core/logger' } else { '../' * $depth + 'core/logger' }
            $importStatement = "`nimport { logger } from '$importPath.js';"
            $content = $content.Insert($lastImport.Index + $lastImport.Length, $importStatement)
        }
    }

    # Replace console.* calls with logger
    $content = $content -replace 'console\.error', 'logger.error'
    $content = $content -replace 'console\.log', 'logger.info'
    $content = $content -replace 'console\.warn', 'logger.warn'
    $content = $content -replace 'console\.debug', 'logger.debug'
    $content = $content -replace 'console\.info', 'logger.info'

    # Write back if changed
    if ($content -ne $originalContent) {
        Set-Content -Path $fullPath -Value $content -NoNewline
        Write-Host "  ✓ Updated" -ForegroundColor Green
    } else {
        Write-Host "  No changes needed" -ForegroundColor Gray
    }
}

# Process tool files
Write-Host "`nProcessing tool files..." -ForegroundColor Yellow
foreach ($file in $toolFiles) {
    Update-ToolFile $file
}

# Process other files
Write-Host "`nProcessing parser files..." -ForegroundColor Yellow
foreach ($file in $parserFiles) {
    Update-NonToolFile $file
}

Write-Host "`nProcessing util files..." -ForegroundColor Yellow
foreach ($file in $utilFiles) {
    Update-NonToolFile $file
}

Write-Host "`nProcessing connection files..." -ForegroundColor Yellow
foreach ($file in $connectionFiles) {
    Update-NonToolFile $file
}

Write-Host "`nProcessing client files..." -ForegroundColor Yellow
foreach ($file in $clientFiles) {
    Update-NonToolFile $file
}

Write-Host "`nProcessing entry files..." -ForegroundColor Yellow
foreach ($file in $entryFiles) {
    Update-NonToolFile $file
}

Write-Host "`nProcessing test files..." -ForegroundColor Yellow
foreach ($file in $testFiles) {
    Update-NonToolFile $file
}

Write-Host "`n✅ Console replacement complete!" -ForegroundColor Green