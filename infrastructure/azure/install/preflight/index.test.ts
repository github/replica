import { expect, it, vi } from "vitest"

import type { InstallerUI, RunCommand } from "../../../installer/types.ts"
import { azurePreflight } from "./index.ts"

function preflight(version: unknown) {
  const run: RunCommand = async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: version })
    if (executable === "az" && args[0] === "account") {
      return JSON.stringify([
        {
          id: "00000000-0000-0000-0000-000000000001",
          tenantId: "00000000-0000-0000-0000-000000000002",
          state: "Enabled",
        },
      ])
    }
    return "{}"
  }
  const ui: InstallerUI = {
    status: vi.fn(),
    confirm: vi.fn(),
    wait: vi.fn(async (message: string) => {
      throw new Error(message)
    }),
  }
  return { run, ui }
}

it.each(["1.13.0", "1.13.4", "1.17.1", "1.99.0", "1.17.1+enterprise"])(
  "accepts supported stable Terraform %s without asking for reinstallation",
  async (version) => {
    const { run, ui } = preflight(version)
    await expect(azurePreflight(run, ui)).resolves.toEqual([
      {
        id: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000002",
        state: "Enabled",
      },
    ])
    expect(ui.wait).not.toHaveBeenCalled()
  },
)

it.each(["1.12.99", "0.15.0", "2.0.0", "1.13.0-beta.1", "not-a-version", undefined])(
  "asks for a supported install rather than continuing with Terraform %s",
  async (version) => {
    const { run, ui } = preflight(version)
    await expect(azurePreflight(run, ui)).rejects.toThrow("Terraform")
    expect(ui.wait).toHaveBeenCalledOnce()
  },
)

it("does not offer tenant-only sign-in accounts or disabled subscriptions as deployment targets", async () => {
  const { ui } = preflight("1.17.1")
  const subscription = {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000002",
    name: "Production",
    state: "Enabled",
  }
  const run: RunCommand = async (executable, args) => {
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.17.1" })
    if (executable === "az" && args[0] === "account")
      return JSON.stringify([
        {
          id: "00000000-0000-0000-0000-000000000003",
          tenantId: "00000000-0000-0000-0000-000000000003",
          name: "N/A(tenant level account)",
          state: "Enabled",
        },
        {
          id: "00000000-0000-0000-0000-000000000004",
          tenantId: "00000000-0000-0000-0000-000000000005",
          name: "Disabled",
          state: "Disabled",
        },
        subscription,
      ])
    return "{}"
  }

  await expect(azurePreflight(run, ui)).resolves.toEqual([subscription])
})
