$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
py -3.14 worker.py --watch
