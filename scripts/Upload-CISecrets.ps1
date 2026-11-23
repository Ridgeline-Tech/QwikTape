[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'github.com/Ridgeline-Tech/QwikTape'
$apiRepo = 'Ridgeline-Tech/QwikTape'
$environmentName = 'qwiktape-release'
$expectedPackage = 'construction.ridgeline.qwiktape'
$localRecord = Join-Path $env:LOCALAPPDATA 'QwikTape\signing\qwiktape-release-current-user.dpapi.json'
if ([string]::IsNullOrWhiteSpace($env:OneDriveCommercial) -or
    -not (Test-Path -LiteralPath $env:OneDriveCommercial -PathType Container)) {
    throw 'OneDriveCommercial must point to the existing signed-in OneDrive folder containing the release identity.'
}
$identityRoot = Join-Path $env:OneDriveCommercial 'ZacsApps\Release Identity\QwikTape'
$publicRecord = Join-Path $identityRoot 'qwiktape-release-public.json'

function Set-ActionSecret([string]$GhPath, [string]$Name, [string]$Value) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $GhPath
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    @('secret', 'set', $Name, '--env', $environmentName, '--repo', $repo) | ForEach-Object { [void]$start.ArgumentList.Add($_) }
    $process = [Diagnostics.Process]::Start($start)
    try {
        $process.StandardInput.Write($Value)
        $process.StandardInput.Close()
        $null = $process.StandardOutput.ReadToEnd()
        $null = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "GitHub rejected secret $Name (exit $($process.ExitCode)); inspect authentication and repository access before retrying." }
        Write-Host "Uploaded $Name to the $repo $environmentName Environment."
    }
    finally { $process.Dispose() }
}

if (-not (Test-Path -LiteralPath $localRecord -PathType Leaf) -or
    -not (Test-Path -LiteralPath $publicRecord -PathType Leaf)) {
    throw 'The dedicated QwikTape identity records are missing. Run Initialize-QwikTapeReleaseIdentity.ps1 through its reviewed wrapper first.'
}

$gh = (Get-Command gh -ErrorAction Stop).Source
$identity = & $gh api --hostname github.com "repos/$apiRepo" --jq '.full_name'
if ($LASTEXITCODE -ne 0 -or $identity -ne $apiRepo) { throw "GitHub target verification failed for $repo." }
$environment = & $gh api --hostname github.com "repos/$apiRepo/environments/$environmentName" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $environment.name -ne $environmentName -or
    -not $environment.deployment_branch_policy.custom_branch_policies -or
    $environment.can_admins_bypass -ne $false) {
    throw 'The protected QwikTape GitHub Environment is missing, permits admin bypass, or no longer uses custom branch restrictions.'
}
$reviewerRules = @($environment.protection_rules | Where-Object { $_.type -eq 'required_reviewers' })
if ($reviewerRules.Count -ne 1 -or $reviewerRules[0].reviewers.Count -ne 1 -or
    $reviewerRules[0].reviewers[0].type -ne 'User' -or
    $reviewerRules[0].reviewers[0].reviewer.login -ne 'Wabull') {
    throw 'The QwikTape Environment must require Zac (Wabull) as its sole reviewer.'
}
$branchPolicies = & $gh api --hostname github.com "repos/$apiRepo/environments/$environmentName/deployment-branch-policies" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $branchPolicies.total_count -ne 1 -or
    $branchPolicies.branch_policies[0].name -ne 'main' -or
    $branchPolicies.branch_policies[0].type -ne 'branch') {
    throw 'The QwikTape Environment must allow only the main deployment branch (type=branch, not a tag).'
}

$wrapped = Get-Content -LiteralPath $localRecord -Raw | ConvertFrom-Json
$public = Get-Content -LiteralPath $publicRecord -Raw | ConvertFrom-Json
if ($wrapped.format -ne 'qwiktape-dpapi-current-user-v1' -or
    $public.format -ne 'qwiktape-public-release-identity-v1') {
    throw 'QwikTape signing record format mismatch.'
}
$secure = ConvertTo-SecureString $wrapped.protectedPayload
$plain = [Net.NetworkCredential]::new('', $secure).Password
$payload = $plain | ConvertFrom-Json
$publicCertificatePath = Join-Path $identityRoot $public.certificateFile
if ($payload.format -ne 'qwiktape-local-signing-v1' -or
    $payload.packageName -ne $expectedPackage -or $public.packageName -ne $expectedPackage -or
    $payload.keyAlias -ne $public.keyAlias -or
    $payload.certificateSha256 -ne $public.certificateSha256 -or
    $payload.certificateSha256 -notmatch '^[0-9a-f]{64}$' -or
    -not (Test-Path -LiteralPath $payload.keystorePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $publicCertificatePath -PathType Leaf)) {
    throw 'QwikTape signing identity did not match its public record, certificate, or keystore path.'
}

$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($publicCertificatePath)
try {
    $certificateSha256 = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
}
finally { $certificate.Dispose() }
if ($certificateSha256 -ne $payload.certificateSha256) {
    throw 'QwikTape public certificate did not match the protected signing identity.'
}

$bytes = [IO.File]::ReadAllBytes($payload.keystorePath)
try {
    $base64 = [Convert]::ToBase64String($bytes)
    Set-ActionSecret $gh 'QWIKTAPE_RELEASE_KEYSTORE_BASE64' $base64
    Set-ActionSecret $gh 'QWIKTAPE_RELEASE_STORE_PASSWORD' $payload.storePassword
    Set-ActionSecret $gh 'QWIKTAPE_RELEASE_KEY_ALIAS' $payload.keyAlias
    Set-ActionSecret $gh 'QWIKTAPE_RELEASE_KEY_PASSWORD' $payload.keyPassword
    Set-ActionSecret $gh 'QWIKTAPE_RELEASE_CERT_SHA256' $payload.certificateSha256
    Write-Host "QwikTape CI signing identity is configured. Public certificate SHA-256: $($payload.certificateSha256)"
}
finally {
    [Security.Cryptography.CryptographicOperations]::ZeroMemory($bytes)
    $base64 = $null
    $plain = $null
    $payload = $null
    $certificateSha256 = $null
    $secure.Dispose()
    [GC]::Collect()
}
