# Gera o APK de release e instala no celular pelo adb (por cima, mantendo os dados).
# Uso, na raiz do projeto:  npm run apk            (gera e instala)
#                            npm run apk:instalar   (só instala o último APK gerado)
param([switch]$SoInstalar)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'

# O JAVA_HOME do Windows aponta para um JDK que não existe; usa o JDK 17 do Android Studio
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'

if (-not $SoInstalar) {
  Write-Host '==> Gerando o APK...' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'android')
  try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Build falhou (código $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

Write-Host '==> Procurando o celular...' -ForegroundColor Cyan
$devices = & $adb devices | Select-String -Pattern '\tdevice$'
if (-not $devices) {
  throw 'Nenhum celular conectado. Ligue a Depuração por Wi-Fi (mesma rede) ou pareie de novo, e rode: npm run apk:instalar'
}

Write-Host '==> Instalando no celular...' -ForegroundColor Cyan
& $adb install -r $apk
if ($LASTEXITCODE -ne 0) { throw "Instalação falhou (código $LASTEXITCODE)." }
Write-Host '==> Pronto! App atualizado no celular.' -ForegroundColor Green
