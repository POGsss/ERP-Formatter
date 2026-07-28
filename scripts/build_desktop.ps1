param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend"
$stagingRoot = Join-Path $repoRoot ".desktop-build"
$stagedFrontendDir = Join-Path $stagingRoot "frontend"
$buildRequirements = Join-Path $repoRoot "backend\requirements-build.txt"
$specFile = Join-Path $repoRoot "ERPFormatter.spec"
$outputFile = Join-Path $repoRoot "dist\ERPFormatter.exe"
$previousNextOutput = $env:NEXT_OUTPUT
$resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
$resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
$expectedStagingRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $resolvedRepoRoot ".desktop-build")
)
if ($resolvedStagingRoot -ne $expectedStagingRoot) {
    throw "Unexpected frontend staging path: $resolvedStagingRoot"
}

if (-not $SkipInstall) {
    & python -m pip install --disable-pip-version-check -r $buildRequirements
    if ($LASTEXITCODE -ne 0) {
        throw "Python dependency installation failed."
    }

    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}
elseif (-not (Test-Path -LiteralPath (Join-Path $stagedFrontendDir "node_modules"))) {
    throw "No staged frontend dependencies exist. Run without -SkipInstall first."
}

New-Item -ItemType Directory -Path $stagedFrontendDir -Force | Out-Null
$frontendSources = @(
    "app",
    "components",
    "types",
    "package.json",
    "package-lock.json",
    "next.config.js",
    "next-env.d.ts",
    "postcss.config.js",
    "tailwind.config.js",
    "tsconfig.json"
)
foreach ($frontendSource in $frontendSources) {
    Copy-Item `
        -LiteralPath (Join-Path $frontendDir $frontendSource) `
        -Destination $stagedFrontendDir `
        -Recurse `
        -Force
}
if (Test-Path -LiteralPath (Join-Path $frontendDir "public")) {
    Copy-Item `
        -LiteralPath (Join-Path $frontendDir "public") `
        -Destination $stagedFrontendDir `
        -Recurse `
        -Force
}

if (-not $SkipInstall) {
    Push-Location $stagedFrontendDir
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend dependency installation failed."
        }
    }
    finally {
        Pop-Location
    }
}

Push-Location $stagedFrontendDir
try {
    $env:NEXT_OUTPUT = "export"
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend static export failed."
    }
}
finally {
    if ($null -eq $previousNextOutput) {
        Remove-Item Env:NEXT_OUTPUT -ErrorAction SilentlyContinue
    }
    else {
        $env:NEXT_OUTPUT = $previousNextOutput
    }
    Pop-Location
}

$stagedOutputDir = Join-Path $stagedFrontendDir "out"
if (-not (Test-Path -LiteralPath (Join-Path $stagedOutputDir "index.html"))) {
    throw "Frontend static export did not produce out\index.html."
}
$frontendOutputDir = Join-Path $frontendDir "out"
$resolvedFrontendOutputDir = [System.IO.Path]::GetFullPath($frontendOutputDir)
$expectedFrontendOutputDir = [System.IO.Path]::GetFullPath(
    (Join-Path $resolvedRepoRoot "frontend\out")
)
if ($resolvedFrontendOutputDir -ne $expectedFrontendOutputDir) {
    throw "Unexpected frontend output path: $resolvedFrontendOutputDir"
}
if (Test-Path -LiteralPath $frontendOutputDir) {
    Remove-Item -LiteralPath $frontendOutputDir -Recurse -Force
}
Copy-Item -LiteralPath $stagedOutputDir -Destination $frontendOutputDir -Recurse

Push-Location $repoRoot
try {
    & python -m PyInstaller --noconfirm --clean $specFile
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
    throw "Desktop build did not produce dist\ERPFormatter.exe."
}

$outputSizeMb = [math]::Round((Get-Item -LiteralPath $outputFile).Length / 1MB, 1)
Write-Output "Built $outputFile ($outputSizeMb MB)"
