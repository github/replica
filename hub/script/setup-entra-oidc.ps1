[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string] $HubOrigin,

  [switch] $Plan,
  [switch] $Apply,
  [switch] $Remove,
  [switch] $Preflight,

  [ValidateNotNullOrEmpty()]
  [string] $TenantId,

  [ValidateNotNullOrEmpty()]
  [string] $ExistingApplicationId,

  [ValidateNotNullOrEmpty()]
  [string] $DisplayName = "Replica Hub",

  [ValidateRange(1, 2147483647)]
  [int] $ProviderRevision = 1,

  [ValidatePattern("^[A-Z][A-Z0-9_]{2,127}$")]
  [string] $ClientCredentialReference = "HUB_OIDC_CLIENT_SECRET",

  [ValidateSet("jit-assignment", "invitation-required")]
  [string] $MembershipPolicy = "jit-assignment",

  [string[]] $UserGroupId = @(),
  [string[]] $AdministratorGroupId = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptOwnerTag = "replica-hub:setup-entra-oidc:v1"
$userRoleId = [Guid] "8ee74d7b-bf6c-5fd6-a70a-b3efad17b3d4"
$administratorRoleId = [Guid] "624f20bd-df7b-5ed4-abeb-6f008f99920f"
$callbackPath = "/api/auth/oidc/callback"

function Get-RequestedAction {
  $actions = @($Plan, $Apply, $Remove, $Preflight).Where({ $_ })
  if ($actions.Count -ne 1) {
    throw "Choose exactly one of -Plan, -Apply, -Remove, or -Preflight."
  }

  if ($Plan) { return "Plan" }
  if ($Apply) { return "Apply" }
  if ($Remove) { return "Remove" }
  return "Preflight"
}

function Get-NormalizedOrigin {
  try {
    $origin = [Uri] $HubOrigin
  }
  catch {
    throw "-HubOrigin must be an absolute HTTPS origin."
  }

  if (-not $origin.IsAbsoluteUri -or $origin.Scheme -ne "https") {
    throw "-HubOrigin must be an absolute HTTPS origin."
  }

  if ($origin.AbsolutePath -ne "/" -or $origin.Query -or $origin.Fragment -or $origin.UserInfo) {
    throw "-HubOrigin must contain only the HTTPS scheme and authority."
  }

  return $origin.GetLeftPart([UriPartial]::Authority)
}

function Get-AppRoles {
  return @(
    @{
      Id = $userRoleId
      AllowedMemberTypes = @("User")
      Description = "Use Replica Hub"
      DisplayName = "Hub User"
      IsEnabled = $true
      Origin = "Application"
      Value = "Hub.User"
    },
    @{
      Id = $administratorRoleId
      AllowedMemberTypes = @("User")
      Description = "Administer Replica Hub"
      DisplayName = "Hub Administrator"
      IsEnabled = $true
      Origin = "Application"
      Value = "Hub.Administrator"
    }
  )
}

function Get-HubConfiguration {
  param(
    [string] $ResolvedTenantId,
    [string] $ApplicationId,
    [string] $CallbackUrl,
    [string] $Status,
    [string[]] $Actions
  )

  [pscustomobject] @{
    Status = $Status
    Actions = @($Actions)
    HUB_OIDC_ISSUER = if ($ResolvedTenantId) {
      "https://login.microsoftonline.com/$ResolvedTenantId/v2.0"
    }
    else {
      $null
    }
    HUB_OIDC_CLIENT_ID = if ($ApplicationId) { $ApplicationId } else { $ExistingApplicationId }
    HUB_OIDC_CALLBACK_URL = $CallbackUrl
    HUB_AUTH_PROVIDER = "oidc"
    HUB_OIDC_ENABLED = "true"
    HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE = $ClientCredentialReference
    HUB_OIDC_SCOPES = "openid profile email"
    HUB_OIDC_MEMBER_ROLE = "Hub.User"
    HUB_OIDC_ADMINISTRATOR_ROLE = "Hub.Administrator"
    HUB_OIDC_MEMBERSHIP_POLICY = $MembershipPolicy
    HUB_OIDC_PROVIDER_REVISION = $ProviderRevision
  }
}

function Import-GraphModules {
  foreach ($module in @(
      "Microsoft.Graph.Authentication",
      "Microsoft.Graph.Applications",
      "Microsoft.Graph.Groups"
    )) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
      throw "Install the Microsoft Graph PowerShell module '$module' before running this action."
    }
    Import-Module $module -ErrorAction Stop
  }
}

function Connect-Graph {
  param([string[]] $Scopes)

  Import-GraphModules
  $connect = @{ Scopes = $Scopes; NoWelcome = $true }
  if ($TenantId) {
    $connect.TenantId = $TenantId
  }
  Connect-MgGraph @connect | Out-Null

  $context = Get-MgContext
  if (-not $context -or -not $context.TenantId) {
    throw "Microsoft Graph did not return a tenant context."
  }
  if ($TenantId -and $context.TenantId -ne $TenantId) {
    throw "Connected tenant '$($context.TenantId)' does not match -TenantId '$TenantId'."
  }
  return $context
}

function Get-ApplicationByAppId {
  param([string] $ApplicationId)

  $escaped = $ApplicationId.Replace("'", "''")
  $applications = @(Get-MgApplication -Filter "appId eq '$escaped'" -All)
  if ($applications.Count -gt 1) {
    throw "Microsoft Graph returned more than one application for app ID '$ApplicationId'."
  }
  return $applications | Select-Object -First 1
}

function Get-OwnedApplication {
  $escaped = $DisplayName.Replace("'", "''")
  $applications = @(Get-MgApplication -Filter "displayName eq '$escaped'" -All)
  $owned = @($applications.Where({ @($_.Tags) -contains $scriptOwnerTag }))
  if ($owned.Count -gt 1) {
    throw "More than one script-owned application is named '$DisplayName'. Use -ExistingApplicationId."
  }
  if ($owned.Count -eq 1) {
    return $owned[0]
  }
  if ($applications.Count -gt 0) {
    throw "An application named '$DisplayName' exists but is not owned by this script. Use -ExistingApplicationId to manage it without granting removal ownership."
  }
  return $null
}

function Resolve-Application {
  if ($ExistingApplicationId) {
    $application = Get-ApplicationByAppId -ApplicationId $ExistingApplicationId
    if (-not $application) {
      throw "Application '$ExistingApplicationId' was not found in the connected tenant."
    }
    return $application
  }
  return Get-OwnedApplication
}

function Assert-ManagedRoleIdsAvailable {
  param($Application)

  foreach ($role in @($Application.AppRoles)) {
    if (($role.Id -eq $userRoleId -and $role.Value -ne "Hub.User") -or
      ($role.Id -eq $administratorRoleId -and $role.Value -ne "Hub.Administrator") -or
      ($role.Value -eq "Hub.User" -and $role.Id -ne $userRoleId) -or
      ($role.Value -eq "Hub.Administrator" -and $role.Id -ne $administratorRoleId)) {
      throw "The application has a conflicting Replica Hub app-role ID or value."
    }
  }
}

function Get-ConvergedRoles {
  param($Application)

  Assert-ManagedRoleIdsAvailable -Application $Application
  $otherRoles = @($Application.AppRoles).Where({
      $_.Value -notin @("Hub.User", "Hub.Administrator")
    })
  return @($otherRoles) + @(Get-AppRoles)
}

function Test-ApplicationDrift {
  param(
    $Application,
    [object[]] $DesiredRoles,
    [string[]] $DesiredRedirectUris
  )

  if ($Application.SignInAudience -ne "AzureADMyOrg") { return $true }
  $actualRedirectUris = @($Application.Web.RedirectUris) | Sort-Object
  $expectedRedirectUris = @($DesiredRedirectUris) | Sort-Object
  if (Compare-Object $actualRedirectUris $expectedRedirectUris) { return $true }

  foreach ($desired in Get-AppRoles) {
    $actual = @($Application.AppRoles).Where({ $_.Value -eq $desired.Value })
    if ($actual.Count -ne 1) { return $true }
    $actualRole = $actual[0]
    if ($actualRole.Id -ne $desired.Id -or
      $actualRole.DisplayName -ne $desired.DisplayName -or
      $actualRole.Description -ne $desired.Description -or
      -not $actualRole.IsEnabled -or
      @($actualRole.AllowedMemberTypes).Count -ne 1 -or
      $actualRole.AllowedMemberTypes[0] -ne "User") {
      return $true
    }
  }

  if (@($Application.AppRoles).Count -ne $DesiredRoles.Count) { return $true }
  return $false
}

function Get-ConvergedRedirectUris {
  param(
    $Application,
    [string] $CallbackUrl
  )

  if (@($Application.Tags) -contains $scriptOwnerTag) {
    return @($CallbackUrl)
  }
  $redirectUris = @($Application.Web.RedirectUris) + @($CallbackUrl)
  return @($redirectUris | Sort-Object -Unique)
}

function Get-ServicePrincipal {
  param([string] $ApplicationId)

  $escaped = $ApplicationId.Replace("'", "''")
  $principals = @(Get-MgServicePrincipal -Filter "appId eq '$escaped'" -All)
  if ($principals.Count -gt 1) {
    throw "Microsoft Graph returned more than one service principal for app ID '$ApplicationId'."
  }
  return $principals | Select-Object -First 1
}

function Assert-GroupsExist {
  param([string[]] $GroupIds)

  foreach ($groupId in $GroupIds | Sort-Object -Unique) {
    Get-MgGroup -GroupId $groupId -Property "id,displayName" | Out-Null
  }
}

function Get-MissingAssignments {
  param(
    $ServicePrincipal,
    [string[]] $UserGroups,
    [string[]] $AdministratorGroups
  )

  $desired = @()
  foreach ($groupId in $UserGroups | Sort-Object -Unique) {
    $desired += [pscustomobject] @{ GroupId = $groupId; RoleId = $userRoleId; Role = "Hub.User" }
  }
  foreach ($groupId in $AdministratorGroups | Sort-Object -Unique) {
    $desired += [pscustomobject] @{ GroupId = $groupId; RoleId = $administratorRoleId; Role = "Hub.Administrator" }
  }

  $missing = @()
  foreach ($assignment in $desired) {
    $existing = @(Get-MgGroupAppRoleAssignment -GroupId $assignment.GroupId -All).Where({
        $_.ResourceId -eq $ServicePrincipal.Id -and $_.AppRoleId -eq $assignment.RoleId
      })
    if ($existing.Count -eq 0) {
      $missing += $assignment
    }
  }
  return $missing
}

function Invoke-Preflight {
  param([string] $CallbackUrl)

  $actions = @(
    "Install Microsoft.Graph.Authentication, Microsoft.Graph.Applications, and Microsoft.Graph.Groups.",
    "Plan requires Application.Read.All and Group.Read.All.",
    "Apply and Remove require Application.ReadWrite.All, AppRoleAssignment.ReadWrite.All, and Group.Read.All.",
    "Tenant administrator approval must be completed through the tenant's normal consent process.",
    "Apply requires at least one -UserGroupId and one -AdministratorGroupId."
  )
  return Get-HubConfiguration -ResolvedTenantId $TenantId -ApplicationId $ExistingApplicationId `
    -CallbackUrl $CallbackUrl -Status "Preflight" -Actions $actions
}

function Invoke-Plan {
  param([string] $CallbackUrl)

  $context = Connect-Graph -Scopes @("Application.Read.All", "Group.Read.All")
  Assert-GroupsExist -GroupIds @($UserGroupId + $AdministratorGroupId)
  $application = Resolve-Application
  $actions = @()

  if (-not $application) {
    $actions += "Create single-tenant application '$DisplayName'."
    $actions += "Create its service principal and require assignment."
    foreach ($groupId in $UserGroupId | Sort-Object -Unique) {
      $actions += "Assign group '$groupId' to Hub.User."
    }
    foreach ($groupId in $AdministratorGroupId | Sort-Object -Unique) {
      $actions += "Assign group '$groupId' to Hub.Administrator."
    }
  }
  else {
    $roles = Get-ConvergedRoles -Application $application
    $redirectUris = Get-ConvergedRedirectUris -Application $application -CallbackUrl $CallbackUrl
    if (Test-ApplicationDrift -Application $application `
        -DesiredRoles $roles -DesiredRedirectUris $redirectUris) {
      $actions += "Converge the callback, audience, and Replica Hub app roles."
    }
    $servicePrincipal = Get-ServicePrincipal -ApplicationId $application.AppId
    if (-not $servicePrincipal) {
      $actions += "Create the service principal and require assignment."
    }
    elseif (-not $servicePrincipal.AppRoleAssignmentRequired) {
      $actions += "Require assignment on the service principal."
    }
    $missing = if ($servicePrincipal) {
      Get-MissingAssignments -ServicePrincipal $servicePrincipal `
        -UserGroups $UserGroupId -AdministratorGroups $AdministratorGroupId
    }
    else { @() }
    foreach ($assignment in $missing) {
      $actions += "Assign group '$($assignment.GroupId)' to $($assignment.Role)."
    }
  }

  if ($UserGroupId.Count -eq 0 -or $AdministratorGroupId.Count -eq 0) {
    $actions += "Provide at least one user group and one administrator group before Apply."
  }
  if ($actions.Count -eq 0) {
    $actions += "No changes are required."
  }

  return Get-HubConfiguration -ResolvedTenantId $context.TenantId `
    -ApplicationId $(if ($application) { $application.AppId } else { $null }) `
    -CallbackUrl $CallbackUrl -Status "Plan" -Actions $actions
}

function Invoke-Apply {
  param([string] $CallbackUrl)

  if ($UserGroupId.Count -eq 0 -or $AdministratorGroupId.Count -eq 0) {
    throw "-Apply requires at least one -UserGroupId and one -AdministratorGroupId."
  }

  $context = Connect-Graph -Scopes @(
    "Application.ReadWrite.All",
    "AppRoleAssignment.ReadWrite.All",
    "Group.Read.All"
  )
  Assert-GroupsExist -GroupIds @($UserGroupId + $AdministratorGroupId)
  $application = Resolve-Application

  if (-not $application) {
    $application = New-MgApplication -DisplayName $DisplayName `
      -SignInAudience "AzureADMyOrg" `
      -Web @{ RedirectUris = @($CallbackUrl) } `
      -AppRoles (Get-AppRoles) `
      -Tags @($scriptOwnerTag)
  }
  else {
    $roles = Get-ConvergedRoles -Application $application
    $redirectUris = Get-ConvergedRedirectUris -Application $application -CallbackUrl $CallbackUrl
    if (Test-ApplicationDrift -Application $application `
        -DesiredRoles $roles -DesiredRedirectUris $redirectUris) {
      Update-MgApplication -ApplicationId $application.Id `
        -SignInAudience "AzureADMyOrg" `
        -Web @{ RedirectUris = $redirectUris } `
        -AppRoles $roles | Out-Null
      $application = Get-ApplicationByAppId -ApplicationId $application.AppId
    }
  }

  $servicePrincipal = Get-ServicePrincipal -ApplicationId $application.AppId
  if (-not $servicePrincipal) {
    $servicePrincipal = New-MgServicePrincipal -AppId $application.AppId -Tags @($scriptOwnerTag)
  }
  if (-not $servicePrincipal.AppRoleAssignmentRequired) {
    Update-MgServicePrincipal -ServicePrincipalId $servicePrincipal.Id `
      -AppRoleAssignmentRequired:$true | Out-Null
    $servicePrincipal.AppRoleAssignmentRequired = $true
  }

  $missing = Get-MissingAssignments -ServicePrincipal $servicePrincipal `
    -UserGroups $UserGroupId -AdministratorGroups $AdministratorGroupId
  foreach ($assignment in $missing) {
    New-MgGroupAppRoleAssignment -GroupId $assignment.GroupId `
      -PrincipalId $assignment.GroupId `
      -ResourceId $servicePrincipal.Id `
      -AppRoleId $assignment.RoleId | Out-Null
  }

  return Get-HubConfiguration -ResolvedTenantId $context.TenantId `
    -ApplicationId $application.AppId -CallbackUrl $CallbackUrl `
    -Status "Applied" -Actions @("Configuration converged.")
}

function Invoke-Remove {
  param([string] $CallbackUrl)

  $context = Connect-Graph -Scopes @(
    "Application.ReadWrite.All",
    "AppRoleAssignment.ReadWrite.All",
    "Group.Read.All"
  )
  $application = Resolve-Application
  if (-not $application) {
    return Get-HubConfiguration -ResolvedTenantId $context.TenantId `
      -ApplicationId $null -CallbackUrl $CallbackUrl `
      -Status "Absent" -Actions @("No script-owned application exists.")
  }

  if (@($application.Tags) -notcontains $scriptOwnerTag) {
    throw "Refusing to remove application '$($application.AppId)' because it is not owned by this script."
  }

  $servicePrincipal = Get-ServicePrincipal -ApplicationId $application.AppId
  if ($servicePrincipal) {
    if (@($servicePrincipal.Tags) -notcontains $scriptOwnerTag) {
      throw "Refusing to remove service principal '$($servicePrincipal.Id)' because it is not owned by this script."
    }
    Remove-MgServicePrincipal -ServicePrincipalId $servicePrincipal.Id
  }
  Remove-MgApplication -ApplicationId $application.Id

  return Get-HubConfiguration -ResolvedTenantId $context.TenantId `
    -ApplicationId $application.AppId -CallbackUrl $CallbackUrl `
    -Status "Removed" -Actions @("Removed script-owned application and service principal.")
}

$action = Get-RequestedAction
$normalizedOrigin = Get-NormalizedOrigin
$callbackUrl = "$normalizedOrigin$callbackPath"

switch ($action) {
  "Preflight" { Invoke-Preflight -CallbackUrl $callbackUrl }
  "Plan" { Invoke-Plan -CallbackUrl $callbackUrl }
  "Apply" { Invoke-Apply -CallbackUrl $callbackUrl }
  "Remove" { Invoke-Remove -CallbackUrl $callbackUrl }
}
