$ErrorActionPreference = 'Stop'
$compilerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../frontend/runtime/toolchains'))
New-Item -ItemType Directory -Path $compilerRoot -Force | Out-Null
$compilerArchive = Join-Path $compilerRoot 'w64devkit-x64-2.9.1.7z.exe'
$compilerHash = '9208c19755cd4964b7915b9afcf02c66d493a4c870c4b3e83f6c538d9c1237a5'
$compilerUrl = 'https://github.com/skeeto/w64devkit/releases/download/v2.9.1/w64devkit-x64-2.9.1.7z.exe'
if (!(Test-Path -LiteralPath $compilerArchive)) {
    Invoke-WebRequest $compilerUrl -OutFile $compilerArchive
}
if ((Get-FileHash -LiteralPath $compilerArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $compilerHash) {
    throw 'Compiler archive checksum mismatch. The archive was not extracted.'
}
$compilerExtractor = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
if (!(Test-Path -LiteralPath $compilerExtractor)) { throw 'Install 7-Zip to extract the portable compiler.' }
& $compilerExtractor x $compilerArchive "-o$compilerRoot" -y -bso0
if ($LASTEXITCODE -ne 0) { throw 'Compiler extraction failed.' }
& (Join-Path $compilerRoot 'w64devkit/bin/gcc.exe') --version
& (Join-Path $compilerRoot 'w64devkit/bin/g++.exe') --version
