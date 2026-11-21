param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Dir
)

$ErrorActionPreference = 'Stop'

function Normalize-PathEntry([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return '' }
  return $p.Trim().TrimEnd('\')
}

$target = Normalize-PathEntry $Dir
if (-not $target) { exit 0 }

$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $current) { $current = '' }

$entries = @()
foreach ($part in ($current -split ';')) {
  $trimmed = $part.Trim()
  if ($trimmed) {
    $entries += $trimmed
  }
}

$filtered = @()
$alreadyExists = $false
foreach ($e in $entries) {
  if ((Normalize-PathEntry $e).Equals($target, [System.StringComparison]::OrdinalIgnoreCase)) {
    $alreadyExists = $true
    if ($Action -eq 'add') {
      $filtered += $e
    }
  } else {
    $filtered += $e
  }
}

if ($Action -eq 'add' -and -not $alreadyExists) {
  $filtered += $target
}

$newValue = ($filtered -join ';')
if ($newValue -ne $current) {
  [Environment]::SetEnvironmentVariable('Path', $newValue, 'User')
}
exit 0
