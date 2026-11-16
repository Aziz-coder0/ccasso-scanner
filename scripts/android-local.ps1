param(
    [switch]$BuildOnly,
    [switch]$Release,
    [switch]$LocalTest,
    [switch]$Clean,
    [string]$Device
)

$ErrorActionPreference = 'Stop'
if ($LocalTest -and -not $Release) { throw 'Use -Release with -LocalTest for a standalone test APK.' }
$projectPath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$toolPath = Join-Path $env:PUBLIC 'ExpoAndroid'

if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    $jdkPath = Get-ChildItem -LiteralPath (Join-Path $toolPath 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jdkPath) { throw 'Install Java 17 and configure JAVA_HOME before building Android.' }
    $env:JAVA_HOME = $jdkPath.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolPath 'sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'))) {
    throw 'Install the Android SDK and configure ANDROID_HOME before building Android.'
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if ($Release) { $env:NODE_ENV = 'production' }
elseif (-not $env:NODE_ENV) { $env:NODE_ENV = 'development' }
$env:EXPO_NO_DOTENV = '1'
$env:CI = '1'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $toolPath 'gradle-cache' }

# Use a short ASCII temporary path for Java's Windows socket files.
$env:TEMP = Join-Path $toolPath 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$javaTempPath = $env:TEMP.Replace('\', '/')
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Dfile.encoding=UTF-8 -Djava.io.tmpdir=$javaTempPath -Djdk.net.unixdomain.tmpdir=$javaTempPath".Trim()

$buildProjectPath = $projectPath
$stagingInfo = $null
# Prebuild standalone test releases from the current Expo config in the short staging path.
if ($LocalTest -or $projectPath.Length -gt 80 -or $projectPath -match '[^\x00-\x7F]') {
    $buildProjectPath = Join-Path $toolPath 'ccasso-scanner'
    $stagingJson = & node (Join-Path $PSScriptRoot 'prepare-android-local.cjs') $projectPath $buildProjectPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the local Android build folder.' }
    $stagingInfo = $stagingJson | ConvertFrom-Json
    Write-Output "Building Android in $buildProjectPath"
}

Push-Location -LiteralPath $buildProjectPath
try {
    if ($stagingInfo -and $stagingInfo.installNeeded) {
        & npm ci --include=dev --prefer-offline --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'Installing local build dependencies failed.' }
    }
    if ($Clean -or ($stagingInfo -and $stagingInfo.prebuildNeeded)) {
        $nativePath = [IO.Path]::GetFullPath((Join-Path $buildProjectPath 'android'))
        if (-not $nativePath.StartsWith($buildProjectPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Native project path is outside this workspace.'
        }
        & npx expo prebuild --clean --npm --platform android
        if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    } elseif (-not (Test-Path -LiteralPath (Join-Path $buildProjectPath 'android\gradlew.bat'))) {
        & npx expo prebuild --npm --platform android
        if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    }
    if ($stagingInfo) {
        [IO.File]::WriteAllText($stagingInfo.statePath, (@{ dependencyHash=$stagingInfo.dependencyHash; nativeHash=$stagingInfo.nativeHash } | ConvertTo-Json))
    }
    $configureArguments = @((Join-Path $PSScriptRoot 'configure-android-local.cjs'), $buildProjectPath)
    if ($LocalTest) { $configureArguments += '--local-test' }
    & node @configureArguments
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure the Android build variant.' }
    if ($BuildOnly -or $Release) {
        Push-Location -LiteralPath (Join-Path $buildProjectPath 'android')
        try {
            if ($Release) {
                & .\gradlew.bat generateCodegenArtifactsFromSchema --build-cache --max-workers=2 '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a'
                if ($LASTEXITCODE -ne 0) { throw 'React Native code generation failed.' }
                & .\gradlew.bat app:assembleRelease -x lint -x test --configure-on-demand --build-cache --max-workers=2 '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a'
            } else {
                & .\gradlew.bat app:assembleDebug -x lint -x test --configure-on-demand --build-cache --max-workers=2 '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a' -PreactNativeDevServerPort=8081
            }
            if ($LASTEXITCODE -ne 0) { throw 'Android APK compilation failed.' }
        } finally { Pop-Location }
    } else {
        $expoArguments = @('expo', 'run:android', '--device', '--no-bundler')
        if ($Device) { $expoArguments += $Device }
        & npx @expoArguments
        if ($LASTEXITCODE -ne 0) { throw 'Android build or device installation failed.' }
    }
    $apkRelativePath = if ($Release) { 'android\app\build\outputs\apk\release\app-release.apk' } else { 'android\app\build\outputs\apk\debug\app-debug.apk' }
    $apkPath = Join-Path $buildProjectPath $apkRelativePath
    $artifactDirectory = Join-Path $projectPath 'output\apk'
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    $appVersion = (Get-Content -LiteralPath (Join-Path $projectPath 'package.json') -Raw | ConvertFrom-Json).version
    $artifactType = if ($LocalTest) { 'local-test' } elseif ($Release) { 'local' } else { 'development' }
    $artifactPath = Join-Path $artifactDirectory "CCASSO-Scanner-$appVersion-$artifactType.apk"
    Copy-Item -LiteralPath $apkPath -Destination $artifactPath -Force
    Write-Output $artifactPath
    if (-not $BuildOnly -and -not $Release) {
        Push-Location -LiteralPath $projectPath
        try { & npx expo start } finally { Pop-Location }
    }
} finally {
    Pop-Location
}
