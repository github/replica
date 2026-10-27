import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"

const script = await readFile(new URL("../setup-entra-oidc.ps1", import.meta.url), "utf8")

function functionBody(name) {
  const start = script.indexOf(`function ${name} {`)
  assert.notEqual(start, -1, `Expected ${name} to exist`)

  const openingBrace = script.indexOf("{", start)
  let depth = 0
  for (let index = openingBrace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1
    if (script[index] === "}") depth -= 1
    if (depth === 0) return script.slice(openingBrace + 1, index)
  }
  assert.fail(`Expected ${name} to have a balanced body`)
}

const mutatingCommands =
  /\b(?:New|Update|Remove)-Mg(?:Application|ServicePrincipal|GroupAppRoleAssignment)\b/

describe("setup-entra-oidc.ps1", () => {
  it("requires exactly one requested action", () => {
    const action = functionBody("Get-RequestedAction")

    assert.match(action, /@\(\$Plan, \$Apply, \$Remove, \$Preflight\)\.Where/)
    assert.match(action, /if \(\$actions\.Count -ne 1\)/)
    assert.match(action, /Choose exactly one of -Plan, -Apply, -Remove, or -Preflight\./)
  })

  it("keeps preflight and plan read-only", () => {
    const preflight = functionBody("Invoke-Preflight")
    const plan = functionBody("Invoke-Plan")

    assert.doesNotMatch(preflight, /\bConnect-MgGraph\b|\b\w+-Mg\w+\b/)
    assert.doesNotMatch(plan, mutatingCommands)
    assert.doesNotMatch(plan, /\b(?:New|Update|Remove)-Mg\w+\b/)
    assert.match(plan, /Application\.Read\.All/)
    assert.match(plan, /Group\.Read\.All/)
  })

  it("converges only drift and missing assignments", () => {
    const apply = functionBody("Invoke-Apply")
    const drift = functionBody("Test-ApplicationDrift")
    const assignments = functionBody("Get-MissingAssignments")

    assert.match(apply, /if \(-not \$application\)[\s\S]*New-MgApplication/)
    assert.match(apply, /if \(Test-ApplicationDrift[\s\S]*Update-MgApplication/)
    assert.match(apply, /if \(-not \$servicePrincipal\)[\s\S]*New-MgServicePrincipal/)
    assert.match(
      apply,
      /if \(-not \$servicePrincipal\.AppRoleAssignmentRequired\)[\s\S]*Update-MgServicePrincipal/,
    )
    assert.match(
      assignments,
      /\$_.ResourceId -eq \$ServicePrincipal\.Id -and \$_.AppRoleId -eq \$assignment\.RoleId/,
    )
    assert.match(apply, /foreach \(\$assignment in \$missing\)[\s\S]*New-MgGroupAppRoleAssignment/)
    assert.match(drift, /AzureADMyOrg/)
    assert.match(drift, /Compare-Object \$actualRedirectUris \$expectedRedirectUris/)
    assert.match(apply, /Assert-GroupsExist[\s\S]*Resolve-Application/)
    assert.match(apply, /Get-MissingAssignments[\s\S]*foreach \(\$assignment in \$missing\)/)
  })

  it("fails closed before removing unowned resources", () => {
    const remove = functionBody("Invoke-Remove")
    const ownershipGuard = remove.indexOf("if (@($application.Tags) -notcontains $scriptOwnerTag)")
    const principalGuard = remove.indexOf(
      "if (@($servicePrincipal.Tags) -notcontains $scriptOwnerTag)",
    )
    const removePrincipal = remove.indexOf("Remove-MgServicePrincipal")
    const removeApplication = remove.indexOf("Remove-MgApplication")

    assert.ok(ownershipGuard >= 0)
    assert.ok(principalGuard > ownershipGuard)
    assert.ok(removePrincipal > principalGuard)
    assert.ok(removeApplication > removePrincipal)
    assert.match(remove, /Refusing to remove application/)
    assert.match(remove, /Refusing to remove service principal/)
  })

  it("makes removal idempotent when no script-owned application exists", () => {
    const remove = functionBody("Invoke-Remove")
    const absentGuard = remove.indexOf("if (-not $application)")
    const absentResult = remove.indexOf('-Status "Absent"', absentGuard)
    const firstMutation = Math.min(
      ...["Remove-MgServicePrincipal", "Remove-MgApplication"]
        .map((command) => remove.indexOf(command))
        .filter((index) => index >= 0),
    )

    assert.ok(absentGuard >= 0)
    assert.ok(absentResult > absentGuard)
    assert.ok(firstMutation > absentResult)
    assert.match(remove, /No script-owned application exists\./)
  })

  it("uses the exact callback, roles, and nonsecret output contract", () => {
    const output = functionBody("Get-HubConfiguration")

    assert.match(script, /\$callbackPath = "\/api\/auth\/oidc\/callback"/)
    assert.match(script, /Value = "Hub\.User"/)
    assert.match(script, /Value = "Hub\.Administrator"/)
    assert.match(script, /-AppRoleAssignmentRequired:\$true/)
    assert.match(output, /HUB_OIDC_ISSUER/)
    assert.match(output, /HUB_OIDC_CLIENT_ID/)
    assert.match(output, /HUB_OIDC_CALLBACK_URL/)
    assert.match(output, /HUB_AUTH_PROVIDER/)
    assert.match(output, /HUB_OIDC_ENABLED/)
    assert.match(output, /HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE/)
    assert.match(output, /HUB_OIDC_SCOPES/)
    assert.match(output, /HUB_OIDC_MEMBER_ROLE/)
    assert.match(output, /HUB_OIDC_MEMBERSHIP_POLICY/)
    assert.match(output, /HUB_OIDC_PROVIDER_REVISION/)
    assert.doesNotMatch(output, /HUB_OIDC_CLIENT_SECRET|ClientSecret|CredentialValue/)
    assert.doesNotMatch(script, /\bWrite-(?:Host|Output|Information|Verbose|Debug)\b/)
    assert.doesNotMatch(
      script,
      /\b(?:Add-MgApplicationPassword|New-MgApplicationPassword|client_?secret|password credential)\b/i,
    )
  })

  it("does not claim removal ownership for an existing application", () => {
    const resolve = functionBody("Resolve-Application")
    const apply = functionBody("Invoke-Apply")
    const redirects = functionBody("Get-ConvergedRedirectUris")

    assert.match(resolve, /if \(\$ExistingApplicationId\)[\s\S]*Get-ApplicationByAppId/)
    const applicationUpdate = apply.match(/Update-MgApplication[\s\S]*?\| Out-Null/)?.[0]
    assert.ok(applicationUpdate)
    assert.doesNotMatch(applicationUpdate, /-Tags/)
    assert.match(apply, /New-MgApplication[\s\S]*-Tags @\(\$scriptOwnerTag\)/)
    assert.match(
      redirects,
      /if \(@\(\$Application\.Tags\) -contains \$scriptOwnerTag\)[\s\S]*return @\(\$CallbackUrl\)/,
    )
    assert.match(
      redirects,
      /\$redirectUris = @\(\$Application\.Web\.RedirectUris\) \+ @\(\$CallbackUrl\)/,
    )
  })
})
