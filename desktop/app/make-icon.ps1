# Draws the tracker's blue tick at several sizes and writes tracker.ico (PNG entries). Run again only to change the icon.
Add-Type -AssemblyName System.Drawing

function New-Png([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 32.0
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 12 * $s; $e = $size - 1
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($e - $r, 0, $r, $r, 270, 90)
  $path.AddArc($e - $r, $e - $r, $r, $r, 0, 90); $path.AddArc(0, $e - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(52, 81, 209))), $path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(2, 4 * $s))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $pts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (8 * $s), (17 * $s)),
    (New-Object System.Drawing.PointF (13 * $s), (22 * $s)),
    (New-Object System.Drawing.PointF (24 * $s), (10 * $s)))
  $g.DrawLines($pen, $pts)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 256
$images = foreach ($size in $sizes) { , (New-Png $size) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) { $w.Write($img) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'tracker.ico'), $out.ToArray())
'Wrote tracker.ico'
