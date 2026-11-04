# Static server for Windows without Node.js (PowerShell is built in), then opens the game.
# Usage: powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [port]
param([int]$Port = 8777)
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$types = @{ '.bin' = 'application/octet-stream'; '.css' = 'text/css'; '.glb' = 'model/gltf-binary'; '.html' = 'text/html'; '.jpg' = 'image/jpeg'; '.js' = 'text/javascript'; '.json' = 'application/json'; '.mjs' = 'text/javascript'; '.png' = 'image/png'; '.wasm' = 'application/wasm' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Grand Theft Oslo on http://localhost:$Port"
Start-Process "http://localhost:$Port/"
while ($listener.IsListening) {
  $context = $listener.GetContext()
  $response = $context.Response
  try {
    $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if (-not $file.StartsWith($root) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $response.StatusCode = 404
    } else {
      $extension = [IO.Path]::GetExtension($file).ToLower()
      $response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
      $response.AddHeader('Cache-Control', 'no-store')
      $stream = [IO.File]::OpenRead($file)
      $response.ContentLength64 = $stream.Length
      $stream.CopyTo($response.OutputStream)
      $stream.Close()
    }
  } catch {
    # The browser dropped the connection (e.g. a reload mid-download); serve the next request.
    Write-Host "Request failed: $($_.Exception.Message)"
  } finally {
    $response.Close()
  }
}
