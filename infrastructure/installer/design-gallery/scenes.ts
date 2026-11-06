import type { Scene } from "./types.ts"

export const scenes: Scene[] = [
  {
    "id": "welcome-and-cloud-selection",
    "group": "Startup and saved sessions",
    "title": "Welcome and cloud selection",
    "source": "infrastructure/installer/cloud-picker/index.tsx:1",
    "kind": "cloud",
    "message": "",
    "purpose": "Introduces Replica and selects the deployment cloud. Azure is the only implemented provider.",
    "decision": "Press Enter on Azure. AWS is explicitly unavailable; Ctrl+C exits.",
    "consequence": "Moves into prerequisite checks. The greeting disappears after the first answered question.",
    "phase": "cloud",
    "columns": 112,
    "rows": 38,
    "welcome": true
  },
  {
    "id": "resume-unfinished-setup",
    "group": "Startup and saved sessions",
    "title": "Resume unfinished setup",
    "source": "infrastructure/installer/wizard/index.ts:76",
    "kind": "select",
    "message": "An unfinished setup was saved 2026-11-06T09:30:00.000Z.\nInstallation: replica-demo; last stage: provision.\nTarget: Azure / 11111111-1111-4111-8111-111111111111 / 22222222-2222-4222-8222-222222222222 / westus2.\nResume setup?",
    "purpose": "Shows a saved draft, target and last recorded stage before asking how to continue.",
    "decision": "Resume setup, start over locally, or exit. The first list item is Resume; selecting it does not grant deployment approval.",
    "consequence": "Resume revalidates the target. Saved stages are checkpoints, not proof that a cloud operation finished.",
    "phase": "cloud",
    "columns": 112,
    "rows": 38,
    "welcome": true,
    "options": [
      {
        "label": "Resume setup",
        "value": "0"
      },
      {
        "label": "Start over (local draft only)",
        "value": "1"
      },
      {
        "label": "Exit and keep the draft",
        "value": "2"
      }
    ]
  },
  {
    "id": "invalid-or-unsupported-draft",
    "group": "Startup and saved sessions",
    "title": "Invalid or unsupported draft",
    "source": "infrastructure/installer/wizard/index.ts:77",
    "kind": "select",
    "message": "The saved session needs attention. Choose how to continue.",
    "purpose": "Preserves an unreadable, unsupported, or differently targeted draft instead of silently discarding it.",
    "decision": "Start over (local draft only) or exit and keep the draft. Resume is unavailable.",
    "consequence": "Starting over still requires separate local-discard consent; no Azure resources or leases are changed.",
    "phase": "cloud",
    "columns": 112,
    "rows": 38,
    "welcome": true,
    "options": [
      {
        "label": "Start over (local draft only)",
        "value": "0"
      },
      {
        "label": "Exit and keep the draft",
        "value": "1"
      }
    ],
    "notice": {
      "level": "error",
      "message": "The saved session at /demo/replica/infrastructure/.local/installation.json.draft.json is invalid, unsupported, or belongs to another configuration. It has been preserved."
    }
  },
  {
    "id": "confirm-local-draft-reset",
    "group": "Startup and saved sessions",
    "title": "Confirm local draft reset",
    "source": "infrastructure/installer/wizard/index.ts:87",
    "kind": "confirm",
    "message": "Discard this local draft? Cloud resources and installation/release locks will not be changed.",
    "purpose": "Makes clear that Start over only resets local saved answers.",
    "decision": "Yes discards the local draft; No is the default and exits with the draft preserved.",
    "consequence": "Cloud resources and both operational locks remain unchanged. This is not a cloud reset.",
    "phase": "cloud",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "interrupted-deployment-warning",
    "group": "Startup and saved sessions",
    "title": "Interrupted deployment warning",
    "source": "infrastructure/installer/wizard/index.ts:101",
    "kind": "wait",
    "message": "Continue to revalidate your configuration. Retained locks will offer recovery checks before proceeding; deployment and lock recovery still require fresh approval.",
    "purpose": "Explains why a recorded deployment stage cannot safely be replayed blindly.",
    "decision": "Enter resumes target revalidation, not automatic lock clearing. Ctrl+C exits.",
    "consequence": "Recovery and deployment each require fresh approval. Ambiguous database provisioning is never automatically replayed.",
    "phase": "cloud",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "This setup was interrupted during deployment. A saved stage does not prove that the operation completed. After revalidating the target, the wizard can inspect retained installation/release locks and guide recovery with fresh consent. It never automatically clears a lock or replays ambiguous database provisioning."
    }
  },
  {
    "id": "local-progress-cannot-be-saved",
    "group": "Startup and saved sessions",
    "title": "Local progress cannot be saved",
    "source": "infrastructure/installer/wizard/index.ts:38",
    "kind": "wait",
    "message": "Could not save local setup progress (ENOSPC). Check disk space and permissions for /demo/replica/infrastructure/.local/installation.json. Your answers remain in memory and the previous draft is preserved. Repair the problem, then retry; no further cloud changes will start while saving is blocked.",
    "purpose": "Blocks further cloud mutations when checkpoint persistence fails.",
    "decision": "Repair disk space or permissions, then Enter retries saving; Ctrl+C stops.",
    "consequence": "Answers remain in memory and the previous on-disk draft is kept. The same screen covers EACCES, EPERM, ENOSPC, EROFS and EIO.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "azure-cli-missing",
    "group": "Prerequisites and access",
    "title": "Azure CLI missing",
    "source": "infrastructure/azure/install/preflight/index.ts:8",
    "kind": "wait",
    "message": "Install Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli\nComplete this prerequisite, then continue to recheck it.",
    "purpose": "Azure CLI is required to discover the target and authenticate cloud operations.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Rechecks this prerequisite only. The wizard provides instructions; it does not install or update workstation tooling.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "terraform-missing-or-incompatible",
    "group": "Prerequisites and access",
    "title": "Terraform missing or incompatible",
    "source": "infrastructure/azure/install/preflight/index.ts:13",
    "kind": "wait",
    "message": "Install Terraform >= 1.13.0 and < 2.0.0: https://developer.hashicorp.com/terraform/install\nComplete this prerequisite, then continue to recheck it.",
    "purpose": "Requires a stable Terraform version >= 1.13.0 and < 2.0.0.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Rechecks this prerequisite only. The wizard provides instructions; it does not install or update workstation tooling.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "docker-unavailable-or-stopped",
    "group": "Prerequisites and access",
    "title": "Docker unavailable or stopped",
    "source": "infrastructure/azure/install/preflight/index.ts:18",
    "kind": "wait",
    "message": "Install and start Docker: https://docs.docker.com/get-started/get-docker/\nComplete this prerequisite, then continue to recheck it.",
    "purpose": "A running local Docker engine is required to build the deployment image.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Rechecks this prerequisite only. The wizard provides instructions; it does not install or update workstation tooling.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "buildx-plugin-unavailable",
    "group": "Prerequisites and access",
    "title": "Buildx plugin unavailable",
    "source": "infrastructure/azure/install/preflight/index.ts:23",
    "kind": "wait",
    "message": "Install the Docker Buildx plugin: https://docs.docker.com/build/install-buildx/\nComplete this prerequisite, then continue to recheck it.",
    "purpose": "Buildx builds and pushes the required linux/amd64 image.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Rechecks this prerequisite only. The wizard provides instructions; it does not install or update workstation tooling.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "container-apps-job-support-missing",
    "group": "Prerequisites and access",
    "title": "Container Apps job support missing",
    "source": "infrastructure/azure/install/preflight/index.ts:28",
    "kind": "wait",
    "message": "Update Azure CLI/its Container Apps extension to support jobs: https://learn.microsoft.com/azure/container-apps/jobs\nComplete this prerequisite, then continue to recheck it.",
    "purpose": "The installed Azure tooling must support Container Apps jobs.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Rechecks this prerequisite only. The wizard provides instructions; it does not install or update workstation tooling.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "azure-sign-in-or-subscription-required",
    "group": "Prerequisites and access",
    "title": "Azure sign-in or subscription required",
    "source": "infrastructure/azure/install/preflight/index.ts:66",
    "kind": "wait",
    "message": "No enabled deployment subscriptions are available. Sign in in a separate terminal with az login (or az login --tenant TENANT_ID for another directory), then continue to reload subscriptions. Tenant-only sign-in is not a deployment target. Sign-in is not automated.",
    "purpose": "Pauses when Azure CLI exposes no enabled deployment subscription.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Sign-in happens in another terminal. Tenant-only accounts are not deployable targets; authentication is not automated.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "saved-installation-target-unavailable",
    "group": "Prerequisites and access",
    "title": "Saved installation target unavailable",
    "source": "infrastructure/azure/install/configure/index.ts:58",
    "kind": "wait",
    "message": "The saved installation subscription is not available in the current Azure sign-in. Restore access in a separate terminal, then recheck. Use another --config path for a different installation; this target will not be changed.",
    "purpose": "Prevents an existing installation from being redirected because the current Azure sign-in changed.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Restore access to the saved tenant and subscription, or use another configuration path for a different installation.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "read-only-discovery-failed",
    "group": "Prerequisites and access",
    "title": "Read-only discovery failed",
    "source": "infrastructure/azure/install/configure/index.ts:43",
    "kind": "wait",
    "message": "Listing Azure regions for the selected subscription failed (exit code 1).\nCheck Azure sign-in, subscription permissions, and connectivity in a separate terminal, then continue to retry this read-only lookup. Your previous choices are retained.",
    "purpose": "Offers a read-only retry if listing regions or provider support fails.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Previous choices are retained. Enter repeats only the failed lookup, not deployment.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Listing Azure regions for the selected subscription"
    ]
  },
  {
    "id": "checking-prerequisite-tools",
    "group": "Prerequisites and access",
    "title": "Checking prerequisite tools",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "progress",
    "message": "Checking Azure CLI, Terraform, Docker, Buildx and Container Apps jobs",
    "purpose": "Represents the shared in-progress layout while tools and access are checked.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "There is no per-tool bespoke form. This synthetic activity label represents the prerequisite-check phase.",
    "phase": "checks",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "choose-azure-tenant",
    "group": "Configuration and input states",
    "title": "Choose Azure tenant",
    "source": "infrastructure/azure/install/configure/index.ts:65",
    "kind": "select",
    "message": "Azure tenant",
    "purpose": "Selects an Azure directory from enabled subscriptions available to Azure CLI.",
    "decision": "Type a name or ID to filter; Up/Down moves the selection and Enter chooses it.",
    "consequence": "Subscription options are constrained to this tenant. If a directory is missing, sign in to it outside the wizard and restart.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Example Engineering (11111111-1111-4111-8111-111111111111)",
        "value": "0"
      },
      {
        "label": "Example Sandbox (33333333-3333-4333-8333-333333333333)",
        "value": "1"
      }
    ],
    "history": [
      "Tenants come from enabled subscriptions in your Azure CLI sign-in. If a tenant is missing, use az login --tenant TENANT_ID in a separate terminal, then restart the wizard."
    ]
  },
  {
    "id": "choose-azure-subscription",
    "group": "Configuration and input states",
    "title": "Choose Azure subscription",
    "source": "infrastructure/azure/install/configure/index.ts:95",
    "kind": "select",
    "message": "Azure subscription",
    "purpose": "Chooses the subscription in which the installation will be billed and managed.",
    "decision": "Filter by name or UUID, then select the authorized target.",
    "consequence": "Changing a draft subscription invalidates its dependent region answer. Existing installations cannot be retargeted.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Engineering sandbox (22222222-2222-4222-8222-222222222222)",
        "value": "22222222-2222-4222-8222-222222222222"
      },
      {
        "label": "Production services (44444444-4444-4444-8444-000000000001)",
        "value": "44444444-4444-4444-8444-000000000001"
      },
      {
        "label": "Design experiments (44444444-4444-4444-8444-000000000002)",
        "value": "44444444-4444-4444-8444-000000000002"
      },
      {
        "label": "Team staging (44444444-4444-4444-8444-000000000003)",
        "value": "44444444-4444-4444-8444-000000000003"
      },
      {
        "label": "Shared tooling (44444444-4444-4444-8444-000000000004)",
        "value": "44444444-4444-4444-8444-000000000004"
      },
      {
        "label": "Platform lab (44444444-4444-4444-8444-000000000005)",
        "value": "44444444-4444-4444-8444-000000000005"
      },
      {
        "label": "Integration test (44444444-4444-4444-8444-000000000006)",
        "value": "44444444-4444-4444-8444-000000000006"
      },
      {
        "label": "Training sandbox (44444444-4444-4444-8444-000000000007)",
        "value": "44444444-4444-4444-8444-000000000007"
      }
    ]
  },
  {
    "id": "picker-search-with-matches",
    "group": "Configuration and input states",
    "title": "Picker search with matches",
    "source": "infrastructure/installer/search-select/index.tsx:5",
    "kind": "select",
    "message": "Azure subscription",
    "purpose": "Shows a real filtered list after typing a search query.",
    "decision": "The typed query is 'sandbox'. Enter chooses the highlighted match; clearing the query restores the list.",
    "consequence": "Filtering is local to available options. It neither requests access nor changes Azure.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Engineering sandbox (22222222-2222-4222-8222-222222222222)",
        "value": "22222222-2222-4222-8222-222222222222"
      },
      {
        "label": "Production services (44444444-4444-4444-8444-000000000001)",
        "value": "44444444-4444-4444-8444-000000000001"
      },
      {
        "label": "Design experiments (44444444-4444-4444-8444-000000000002)",
        "value": "44444444-4444-4444-8444-000000000002"
      },
      {
        "label": "Team staging (44444444-4444-4444-8444-000000000003)",
        "value": "44444444-4444-4444-8444-000000000003"
      },
      {
        "label": "Shared tooling (44444444-4444-4444-8444-000000000004)",
        "value": "44444444-4444-4444-8444-000000000004"
      },
      {
        "label": "Platform lab (44444444-4444-4444-8444-000000000005)",
        "value": "44444444-4444-4444-8444-000000000005"
      },
      {
        "label": "Integration test (44444444-4444-4444-8444-000000000006)",
        "value": "44444444-4444-4444-8444-000000000006"
      },
      {
        "label": "Training sandbox (44444444-4444-4444-8444-000000000007)",
        "value": "44444444-4444-4444-8444-000000000007"
      }
    ],
    "inputs": [
      "sandbox"
    ]
  },
  {
    "id": "picker-search-with-no-matches",
    "group": "Configuration and input states",
    "title": "Picker search with no matches",
    "source": "infrastructure/installer/search-select/index.tsx:34",
    "kind": "select",
    "message": "Azure subscription",
    "purpose": "Shows the empty-search feedback when no authorized option matches.",
    "decision": "Edit or clear the search. Enter cannot choose an absent option.",
    "consequence": "No fallback subscription is silently selected.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Engineering sandbox (22222222-2222-4222-8222-222222222222)",
        "value": "22222222-2222-4222-8222-222222222222"
      },
      {
        "label": "Production services (44444444-4444-4444-8444-000000000001)",
        "value": "44444444-4444-4444-8444-000000000001"
      },
      {
        "label": "Design experiments (44444444-4444-4444-8444-000000000002)",
        "value": "44444444-4444-4444-8444-000000000002"
      },
      {
        "label": "Team staging (44444444-4444-4444-8444-000000000003)",
        "value": "44444444-4444-4444-8444-000000000003"
      },
      {
        "label": "Shared tooling (44444444-4444-4444-8444-000000000004)",
        "value": "44444444-4444-4444-8444-000000000004"
      },
      {
        "label": "Platform lab (44444444-4444-4444-8444-000000000005)",
        "value": "44444444-4444-4444-8444-000000000005"
      },
      {
        "label": "Integration test (44444444-4444-4444-8444-000000000006)",
        "value": "44444444-4444-4444-8444-000000000006"
      },
      {
        "label": "Training sandbox (44444444-4444-4444-8444-000000000007)",
        "value": "44444444-4444-4444-8444-000000000007"
      }
    ],
    "inputs": [
      "not-a-subscription"
    ]
  },
  {
    "id": "picker-list-scrolled",
    "group": "Configuration and input states",
    "title": "Picker list scrolled",
    "source": "infrastructure/installer/search-select/index.tsx:30",
    "kind": "select",
    "message": "Azure subscription",
    "purpose": "Shows the five-row option viewport after moving into a longer list.",
    "decision": "Up/Down scrolls the selection; Enter chooses it.",
    "consequence": "The option count explains that additional entries exist outside the visible slice.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Engineering sandbox (22222222-2222-4222-8222-222222222222)",
        "value": "22222222-2222-4222-8222-222222222222"
      },
      {
        "label": "Production services (44444444-4444-4444-8444-000000000001)",
        "value": "44444444-4444-4444-8444-000000000001"
      },
      {
        "label": "Design experiments (44444444-4444-4444-8444-000000000002)",
        "value": "44444444-4444-4444-8444-000000000002"
      },
      {
        "label": "Team staging (44444444-4444-4444-8444-000000000003)",
        "value": "44444444-4444-4444-8444-000000000003"
      },
      {
        "label": "Shared tooling (44444444-4444-4444-8444-000000000004)",
        "value": "44444444-4444-4444-8444-000000000004"
      },
      {
        "label": "Platform lab (44444444-4444-4444-8444-000000000005)",
        "value": "44444444-4444-4444-8444-000000000005"
      },
      {
        "label": "Integration test (44444444-4444-4444-8444-000000000006)",
        "value": "44444444-4444-4444-8444-000000000006"
      },
      {
        "label": "Training sandbox (44444444-4444-4444-8444-000000000007)",
        "value": "44444444-4444-4444-8444-000000000007"
      }
    ],
    "inputs": [
      "\u001b[B",
      "\u001b[B",
      "\u001b[B",
      "\u001b[B",
      "\u001b[B",
      "\u001b[B"
    ]
  },
  {
    "id": "choose-compatible-azure-region",
    "group": "Configuration and input states",
    "title": "Choose compatible Azure region",
    "source": "infrastructure/azure/install/configure/index.ts:162",
    "kind": "select",
    "message": "Azure region",
    "purpose": "Offers only regions advertising all four required services: Container Apps, PostgreSQL, ACR and Key Vault.",
    "decision": "Choose the deployment location; consider latency, data residency and subscription access.",
    "consequence": "Advertised region support is not a guarantee of quota or policy approval.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "West US 2 (westus2)",
        "value": "0"
      },
      {
        "label": "East US (eastus)",
        "value": "1"
      },
      {
        "label": "West Europe (westeurope)",
        "value": "2"
      },
      {
        "label": "North Europe (northeurope)",
        "value": "3"
      }
    ]
  },
  {
    "id": "saved-update-target-markers",
    "group": "Configuration and input states",
    "title": "Saved update target markers",
    "source": "infrastructure/azure/install/configure/index.ts:106",
    "kind": "select",
    "message": "Azure subscription",
    "purpose": "Highlights the saved target when updating an existing installation without an unfinished draft.",
    "decision": "Keep the saved target. Selecting another target is rejected later rather than silently moving the installation.",
    "consequence": "The same marker pattern appears for tenant and region. Valid draft choices may be reused without showing the picker.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "Engineering sandbox (22222222-2222-4222-8222-222222222222) - saved target",
        "value": "22222222-2222-4222-8222-222222222222"
      },
      {
        "label": "Production services (44444444-4444-4444-8444-000000000001)",
        "value": "44444444-4444-4444-8444-000000000001"
      }
    ]
  },
  {
    "id": "saved-draft-choice-no-longer-available",
    "group": "Configuration and input states",
    "title": "Saved draft choice no longer available",
    "source": "infrastructure/azure/install/configure/index.ts:27",
    "kind": "select",
    "message": "Azure region",
    "purpose": "Explains why a previously saved draft answer must be selected again.",
    "decision": "Choose an option currently available to the authorized identity.",
    "consequence": "Dependent answers are rechecked. This does not bypass the immutable target guard for an existing installation.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "options": [
      {
        "label": "West US 2 (westus2)",
        "value": "0"
      },
      {
        "label": "East US (eastus)",
        "value": "1"
      },
      {
        "label": "West Europe (westeurope)",
        "value": "2"
      },
      {
        "label": "North Europe (northeurope)",
        "value": "3"
      }
    ],
    "notice": {
      "level": "warning",
      "message": "The saved azure region is no longer available. Choose an authorized option; dependent choices will be checked again."
    }
  },
  {
    "id": "installation-name",
    "group": "Configuration and input states",
    "title": "Installation name",
    "source": "infrastructure/installer/config/fields/index.ts:58",
    "kind": "field",
    "message": "",
    "purpose": "Establishes the stable installation identity and derived Azure resource names.",
    "decision": "Edit the value and Enter submits it. Inline help defines the allowed format.",
    "consequence": "Saved configuration and remote Terraform state must stay associated with this installation.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "name",
    "initial": "replica-demo"
  },
  {
    "id": "ownership-tag",
    "group": "Configuration and input states",
    "title": "Ownership tag",
    "source": "infrastructure/installer/config/fields/index.ts:58",
    "kind": "field",
    "message": "",
    "purpose": "Records a stable team or person label on Azure resource tags.",
    "decision": "Edit the value and Enter submits it. Inline help defines the allowed format.",
    "consequence": "This label does not assign access or billing; an existing installation's owner cannot be changed through this flow.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "owner",
    "initial": "design-team"
  },
  {
    "id": "dedicated-application-resource-group",
    "group": "Configuration and input states",
    "title": "Dedicated application resource group",
    "source": "infrastructure/installer/config/fields/index.ts:58",
    "kind": "field",
    "message": "",
    "purpose": "Accepts a dedicated group for the app, database, storage, network and jobs.",
    "decision": "Edit the value and Enter submits it. Inline help defines the allowed format.",
    "consequence": "State and foundation groups are derived separately and reused on later updates to this same installation.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "resourceGroup",
    "initial": "replica-demo-hub"
  },
  {
    "id": "field-validation-error",
    "group": "Configuration and input states",
    "title": "Field validation error",
    "source": "infrastructure/installer/terminal/field/index.tsx:40",
    "kind": "field",
    "message": "",
    "purpose": "Shows actual field validation after submitting an invalid installation name.",
    "decision": "Correct the value, then submit again. The current invalid text remains editable.",
    "consequence": "The wizard cannot advance or save this answer until it passes the canonical field parser.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "name",
    "initial": "Demo Hub!",
    "inputs": [
      "\r"
    ]
  },
  {
    "id": "configure-optional-npm-proxy",
    "group": "Configuration and input states",
    "title": "Configure optional npm proxy",
    "source": "infrastructure/azure/install/configure/index.ts:183",
    "kind": "confirm",
    "message": "Configure an npm proxy for the container build? Docker does not inherit host npm settings; configure a proxy here if your network blocks the public npm registry.",
    "purpose": "Makes container-build package access explicit; Docker does not inherit host npm settings.",
    "decision": "Yes opens the registry URL field. No is the default. In a network that blocks public npm, choose Yes.",
    "consequence": "This sample uses the company proxy. The saved URL becomes a Docker build argument, not a workstation-wide npm setting.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Terraform state uses Azure sign-in and Blob data permissions, without an IP allowlist. Shared-key and anonymous blob access remain disabled."
    ]
  },
  {
    "id": "enter-https-npm-registry",
    "group": "Configuration and input states",
    "title": "Enter HTTPS npm registry",
    "source": "infrastructure/installer/config/fields/index.ts:89",
    "kind": "field",
    "message": "",
    "purpose": "Collects an optional credential-free HTTPS npm proxy URL.",
    "decision": "Enter the URL from the package-feed administrator. Do not enter credentials, a query string or a fragment.",
    "consequence": "Only the documented non-secret URL is saved. The same field is reused by image-publication recovery.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "npmRegistry",
    "initial": "https://packagefeedproxy.microsoft.io/npm/"
  },
  {
    "id": "rejected-registry-url-is-cleared",
    "group": "Configuration and input states",
    "title": "Rejected registry URL is cleared",
    "source": "infrastructure/installer/terminal/field/index.tsx:49",
    "kind": "field",
    "message": "",
    "purpose": "Shows actual submission feedback for a non-HTTPS registry URL.",
    "decision": "Retype a valid credential-free HTTPS URL; the rejected input is cleared.",
    "consequence": "Clearing rejected input also avoids retaining pasted credential-like content in the field.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "npmRegistry",
    "initial": "http://packages.example.invalid/npm/",
    "inputs": [
      "\r"
    ]
  },
  {
    "id": "configuration-saved-for-review",
    "group": "Configuration and input states",
    "title": "Configuration saved for review",
    "source": "infrastructure/installer/wizard/index.ts:124",
    "kind": "progress",
    "message": "Saved non-secret configuration to /demo/replica/infrastructure/.local/installation.json",
    "purpose": "Confirms the documented non-secret JSON configuration has been saved before deployment approval.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "Saving configuration is not authorization to create cloud resources.",
    "phase": "review",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "authorize-billable-deployment",
    "group": "Resource approval and provisioning",
    "title": "Authorize billable deployment",
    "source": "infrastructure/azure/install/index.ts:80",
    "kind": "confirm",
    "message": "Authorize resource creation, role assignments, image publication, and a maintenance-window deployment in this subscription?",
    "purpose": "Collects explicit approval for billable resources, role assignments, image publication and a maintenance-window deployment.",
    "decision": "Yes proceeds; No is the default and stops before cloud changes.",
    "consequence": "This is broad installation authorization, not the later fresh downtime confirmation. Hub sign-in requires manual configuration; hosted previews and reviews are unavailable. HTTPS readiness does not verify authorization.",
    "phase": "review",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Target: 22222222-2222-4222-8222-222222222222 / westus2. App group: replica-demo-hub. State group: replica-demo-state. Foundation group: replica-demo-foundation.\nThis creates billable PostgreSQL, Container Apps, Blob Storage, ACR, Key Vault and logs, publishes an image, and requires a maintenance window. Hub sign-in requires manual configuration; hosted previews and reviews are not available yet. HTTPS readiness does not verify authorization."
    },
    "history": [
      "Target: 22222222-2222-4222-8222-222222222222 / westus2. App group: replica-demo-hub. State group: replica-demo-state. Foundation group: replica-demo-foundation.",
      "State access: Azure authentication and Blob data permissions, without IP restrictions. npm registry: https://packagefeedproxy.microsoft.io/npm/. ACR: replicademo. Key Vault: replica-demo-vault.",
      "This creates billable PostgreSQL, Container Apps, Blob Storage, ACR, Key Vault and logs. It is not high availability. Hub sign-in requires manual configuration; hosted previews and reviews are not available yet."
    ]
  },
  {
    "id": "administrator-provider-registration",
    "group": "Resource approval and provisioning",
    "title": "Administrator provider registration",
    "source": "infrastructure/azure/install/index.ts:107",
    "kind": "wait",
    "message": "An administrator must register Microsoft.App in subscription 22222222-2222-4222-8222-222222222222. Complete that action, then continue to recheck.",
    "purpose": "Pauses when an Azure provider registration cannot be completed by the deployment identity.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "An administrator registers the named provider, then Enter verifies it. This wait is parameterized for all eight required provider namespaces.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "preparing-protected-terraform-state",
    "group": "Resource approval and provisioning",
    "title": "Preparing protected Terraform state",
    "source": "infrastructure/azure/install/index.ts:112",
    "kind": "progress",
    "message": "Preparing protected Terraform state",
    "purpose": "Represents state-account and backend preparation with authenticated Blob access.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "This is provisioning progress, not a second application resource-group picker.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "change-existing-state-network-restriction",
    "group": "Resource approval and provisioning",
    "title": "Change existing state network restriction",
    "source": "infrastructure/azure/install/backend/index.ts:120",
    "kind": "confirm",
    "message": "State account replicastatedemo restricts network access. Remove its network restriction and use Azure authentication and Blob data permissions instead? Shared-key and anonymous access will remain disabled.",
    "purpose": "Requests explicit permission before changing an owned state account from deny-by-default networking.",
    "decision": "Yes removes this network restriction; No is the default and leaves account networking unchanged.",
    "consequence": "Azure sign-in and Blob data permissions remain required. Shared keys and anonymous access remain disabled. Private/perimeter/unknown policies are not overridden.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "state-storage-access-not-ready",
    "group": "Resource approval and provisioning",
    "title": "State storage access not ready",
    "source": "infrastructure/azure/install/backend/index.ts:206",
    "kind": "wait",
    "message": "State storage is not reachable yet. Allow RBAC propagation and verify Azure sign-in, Storage Blob Data Contributor permission, connectivity, and subscription policy, then continue to retry.",
    "purpose": "Distinguishes Blob data authorization, propagation, connectivity and policy from management-plane access.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Repair access or allow RBAC propagation, then retry. The wizard does not enable shared keys as a bypass.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "foundation-terraform-plan",
    "group": "Resource approval and provisioning",
    "title": "Foundation Terraform plan",
    "source": "infrastructure/terraform/index.ts:90",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Reviews the foundation module's registry and Key Vault resources.",
    "decision": "Review the resource addresses. Yes applies this saved plan; No is the default and stops.",
    "consequence": "Applies only this module's plan. Sensitive resource values are not printed in the plan summary.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_resource_group.foundation\ncreate azurerm_container_registry.hub\ncreate azurerm_key_vault.hub"
    },
    "history": [
      "create azurerm_resource_group.foundation",
      "create azurerm_container_registry.hub",
      "create azurerm_key_vault.hub"
    ]
  },
  {
    "id": "key-vault-access-not-ready",
    "group": "Resource approval and provisioning",
    "title": "Key Vault access not ready",
    "source": "infrastructure/azure/install/secrets/index.ts:20",
    "kind": "wait",
    "message": "Key Vault access is not ready. Check Key Vault Secrets Officer permission, network access, and RBAC propagation, then continue to retry.",
    "purpose": "Waits for Key Vault secret-data permissions, networking or RBAC propagation.",
    "decision": "Complete the external action, then Enter rechecks. Ctrl+C exits and preserves progress.",
    "consequence": "Enter repeats the access check. Generated secret values are not displayed in the wizard or this guide.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "publish-uncommitted-source",
    "group": "Resource approval and provisioning",
    "title": "Publish uncommitted source",
    "source": "infrastructure/azure/install/image/index.ts:27",
    "kind": "confirm",
    "message": "The source checkout has uncommitted changes. Build and publish this working tree?",
    "purpose": "Makes publication of a dirty working tree an explicit user decision.",
    "decision": "Yes builds the current files; No is the default and cancels image publication.",
    "consequence": "Publication is separate from Git commit/push. A retry can ask this question again if the checkout remains dirty.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "building-and-publishing-image",
    "group": "Resource approval and provisioning",
    "title": "Building and publishing image",
    "source": "infrastructure/azure/install/index.ts:162",
    "kind": "progress",
    "message": "Building and publishing the Hub image",
    "purpose": "Shows the shared spinner/activity layout while ACR login and Docker Buildx publication run.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "Builds linux/amd64 and records an immutable digest. The wizard does not expose a live build-log pane here.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Preparing registry and Key Vault",
      "Building and publishing the Hub image"
    ]
  },
  {
    "id": "initial-application-terraform-plan",
    "group": "Resource approval and provisioning",
    "title": "Initial application Terraform plan",
    "source": "infrastructure/terraform/index.ts:90",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Reviews initial app infrastructure, before the first Hub revision is released.",
    "decision": "Review the resource addresses. Yes applies this saved plan; No is the default and stops.",
    "consequence": "Initial bootstrapping leaves Hub stopped while database prerequisites are prepared.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_resource_group.hub\ncreate azurerm_postgresql_flexible_server.hub\ncreate azurerm_container_app_environment.hub\ncreate azurerm_storage_account.hub"
    },
    "history": [
      "create azurerm_resource_group.hub",
      "create azurerm_postgresql_flexible_server.hub",
      "create azurerm_container_app_environment.hub",
      "create azurerm_storage_account.hub"
    ]
  },
  {
    "id": "temporary-database-provisioning-plan",
    "group": "Resource approval and provisioning",
    "title": "Temporary database provisioning plan",
    "source": "infrastructure/terraform/index.ts:90",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Reviews the short-lived job, identity and grants used for private-network database initialization.",
    "decision": "Review the resource addresses. Yes applies this saved plan; No is the default and stops.",
    "consequence": "The wizard does not blindly repeat provisioning if prior executions exist without a completion marker.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_user_assigned_identity.provision\ncreate azurerm_container_app_job.provision\ncreate azurerm_role_assignment.provision_secrets"
    },
    "history": [
      "create azurerm_user_assigned_identity.provision",
      "create azurerm_container_app_job.provision",
      "create azurerm_role_assignment.provision_secrets"
    ]
  },
  {
    "id": "database-initialization-in-progress",
    "group": "Resource approval and provisioning",
    "title": "Database initialization in progress",
    "source": "infrastructure/azure/install/index.ts:207",
    "kind": "progress",
    "message": "Checking private-network database initialization",
    "purpose": "Represents the waiting state while the fresh-database job runs or an existing provisioning marker is checked.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The release lease serializes database setup; completed installations skip fresh provisioning when no temporary state remains.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Bootstrapping infrastructure with Hub stopped",
      "Checking private-network database initialization"
    ]
  },
  {
    "id": "remove-temporary-provisioning-resources",
    "group": "Resource approval and provisioning",
    "title": "Remove temporary provisioning resources",
    "source": "infrastructure/terraform/index.ts:89",
    "kind": "confirm",
    "message": "Remove only the temporary database provisioning job, identity, and grants?",
    "purpose": "Reviews cleanup after successful database provisioning.",
    "decision": "Yes removes the temporary job, identity and grants; No is the default and leaves cleanup for recovery.",
    "consequence": "This destroy is scoped to the temporary provisioning module, not the persistent app, database, state or foundation resources.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ndelete azurerm_container_app_job.provision\ndelete azurerm_user_assigned_identity.provision\ndelete azurerm_role_assignment.provision_secrets"
    }
  },
  {
    "id": "fresh-maintenance-window-approval",
    "group": "Release and completion",
    "title": "Fresh maintenance-window approval",
    "source": "infrastructure/azure/install/index.ts:222",
    "kind": "confirm",
    "message": "Stop all Hub revisions, run setup, and release this image? Hub will be unavailable during this maintenance window.",
    "purpose": "Asks for downtime approval immediately before this specific image is released.",
    "decision": "Yes starts the serialized release; No is the default and keeps infrastructure provisioned with the installation lease retained for review.",
    "consequence": "Old revisions stop, setup runs and the new revision is activated. Earlier deployment consent does not replace this fresh approval.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Release replicademo.azurecr.io/replica-hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa in subscription 22222222-2222-4222-8222-222222222222. Hub will be unavailable while all old revisions stop and setup runs. This requires fresh maintenance-window approval."
    }
  },
  {
    "id": "serialized-release-in-progress",
    "group": "Release and completion",
    "title": "Serialized release in progress",
    "source": "infrastructure/azure/install/index.ts:231",
    "kind": "progress",
    "message": "Running the serialized maintenance-window release",
    "purpose": "Shows release execution under operational serialization.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The native release handles revision draining, setup and readiness. These are not separate interactive forms.",
    "phase": "release",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Running the serialized maintenance-window release"
    ]
  },
  {
    "id": "verify-deployment-result",
    "group": "Release and completion",
    "title": "Verify deployment result",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "progress",
    "message": "Checking final Terraform outputs and deployment resource identities",
    "purpose": "Represents final output validation before returning a successful deployment receipt.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "This synthetic activity description labels the phase; it is not a new production status string. Receipt output waits for successful lock release and cleanup.",
    "phase": "verify",
    "columns": 112,
    "rows": 38,
    "welcome": false
  },
  {
    "id": "wizard-complete-before-shell-restoration",
    "group": "Release and completion",
    "title": "Wizard complete before shell restoration",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "progress",
    "message": "Complete",
    "purpose": "Captures the short-lived completed TUI state before unmounting the alternate screen.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The durable, copyable deployment report is printed next in the normal shell.",
    "phase": "verify",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "complete": true
  },
  {
    "id": "deployment-receipt-and-primary-resources",
    "group": "Release and completion",
    "title": "Deployment receipt and primary resources",
    "source": "infrastructure/installer/deployment-summary/index.ts:3",
    "kind": "shell",
    "message": "",
    "purpose": "Shows the actual shared success formatter with synthetic verified-result data after terminal restoration.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Includes service URL, target, region, immutable image, saved config and initial resource links. This is not evidence that a real deployment ran.",
    "phase": "configure",
    "columns": 112,
    "rows": 36,
    "welcome": false,
    "receipt": "primary"
  },
  {
    "id": "deployment-receipt-remaining-resource-links",
    "group": "Release and completion",
    "title": "Deployment receipt remaining resource links",
    "source": "infrastructure/installer/deployment-summary/index.ts:3",
    "kind": "shell",
    "message": "",
    "purpose": "Continues the normal-shell receipt with resource-specific Azure portal links.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "HTTPS readiness does not verify sign-in or authorization; Hub sign-in requires manual configuration. The sample service domain is deliberately non-resolvable.",
    "phase": "configure",
    "columns": 112,
    "rows": 28,
    "welcome": false,
    "receipt": "remaining"
  },
  {
    "id": "configuration-only-completion",
    "group": "Release and completion",
    "title": "Configuration-only completion",
    "source": "infrastructure/installer/wizard/index.ts:128",
    "kind": "shell",
    "message": "Configuration saved to /demo/replica/infrastructure/.local/installation.json. No Azure resources were changed.",
    "purpose": "Shows the terminal result of --configure-only, after local JSON creation and terminal cleanup.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Configuration-only skips Azure provisioning/release, but still performs prerequisite and target discovery checks.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "image-build-recovery-choices",
    "group": "Image publication recovery",
    "title": "Image build recovery choices",
    "source": "infrastructure/azure/install/image/index.ts:69",
    "kind": "select",
    "message": "How would you like to recover image publication?",
    "purpose": "Keeps a recoverable image-build or publication failure inside the wizard.",
    "decision": "Retry only image publication, change the npm proxy, show details, or exit. The first item is Retry; no action runs until selected.",
    "consequence": "Infrastructure and database work are not repeated. An earlier attempt may already have published a candidate image.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Build and publish the Hub image failed (exit code 1).\nContainer npm proxy: configured. Docker does not inherit host npm settings.\nRetry affects image publication only, not infrastructure or database work. A previous attempt may already have published a candidate image."
    },
    "options": [
      {
        "label": "Retry image build and publication",
        "value": "0"
      },
      {
        "label": "Set or change the npm proxy, then retry",
        "value": "1"
      },
      {
        "label": "Show full error details",
        "value": "2"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "3"
      }
    ]
  },
  {
    "id": "image-build-full-error-details",
    "group": "Image publication recovery",
    "title": "Image build full error details",
    "source": "infrastructure/installer/prompt-for-recovery/index.ts:32",
    "kind": "wait",
    "message": "Build and publish the Hub image failed (exit code 1).\nDocker build: npm package request could not reach the configured feed.\n\nContainer npm registry: https://packagefeedproxy.microsoft.io/npm/.\nCheck the build error, Docker/Buildx, network access, and ACR push permissions. A previous attempt may have published a candidate image.\nScroll to inspect the output, then press Enter to return to recovery choices. This does not retry the step.",
    "purpose": "Shows the local failure text and image-specific troubleshooting guidance.",
    "decision": "Scroll if needed; Enter returns to recovery choices, not a retry. Ctrl+C exits.",
    "consequence": "Full details can contain local paths or command output. This capture intentionally uses a short synthetic diagnostic.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Build and publish the Hub image failed (exit code 1).\nContainer npm proxy: configured. Docker does not inherit host npm settings.\nRetry affects image publication only, not infrastructure or database work. A previous attempt may already have published a candidate image."
    }
  },
  {
    "id": "change-npm-proxy-during-recovery",
    "group": "Image publication recovery",
    "title": "Change npm proxy during recovery",
    "source": "infrastructure/azure/install/image/index.ts:80",
    "kind": "field",
    "message": "",
    "purpose": "Reuses the canonical registry field rather than restarting the wizard.",
    "decision": "Enter a corrected HTTPS feed URL.",
    "consequence": "The value is persisted before an image-only retry; it is also used by subsequent installation updates.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "field": "npmRegistry",
    "initial": "https://packagefeedproxy.microsoft.io/npm/",
    "notice": {
      "level": "error",
      "message": "Build and publish the Hub image failed (exit code 1).\nContainer npm proxy: configured. Docker does not inherit host npm settings.\nRetry affects image publication only, not infrastructure or database work. A previous attempt may already have published a candidate image."
    }
  },
  {
    "id": "image-only-retry-in-progress",
    "group": "Image publication recovery",
    "title": "Image-only retry in progress",
    "source": "infrastructure/azure/install/image/index.ts:83",
    "kind": "progress",
    "message": "Retrying image build and publication.",
    "purpose": "Shows the recovery notice while retrying the image step.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The checkout is reconsidered and dirty-source consent may appear again. Earlier Terraform/database steps are not replayed.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "info",
      "message": "Retrying image build and publication."
    },
    "history": [
      "Saved the npm proxy for this installation. Retrying image publication."
    ]
  },
  {
    "id": "terraform-failure-recovery-choices",
    "group": "Terraform step recovery",
    "title": "Terraform failure recovery choices",
    "source": "infrastructure/terraform/index.ts:111",
    "kind": "select",
    "message": "How would you like to recover this Terraform step?",
    "purpose": "Explains that a failed apply may have partially succeeded and offers a safe fresh plan.",
    "decision": "Replan and review this step, show full details, or exit.",
    "consequence": "Retry never blindly reapplies an old plan or restarts setup. State locking, ownership and destructive-change guards stay active.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Apply Terraform changes failed (exit code 1).\nTerraform may have applied some changes. Retry prepares a fresh plan for review; it does not restart setup.\nIf access was just granted, allow permission propagation and check data permissions, network rules, and policy before retrying."
    },
    "options": [
      {
        "label": "Replan and review this Terraform step",
        "value": "0"
      },
      {
        "label": "Show full error details",
        "value": "1"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "2"
      }
    ]
  },
  {
    "id": "terraform-error-details-and-guidance",
    "group": "Terraform step recovery",
    "title": "Terraform error details and guidance",
    "source": "infrastructure/installer/prompt-for-recovery/index.ts:32",
    "kind": "wait",
    "message": "Apply Terraform changes failed (exit code 1).\nError: checking for existing Blob deployment.lock: unexpected status 403.\nThe request is not authorized by the current Blob data permissions.\n\nA failed apply can leave resources recorded in Terraform state. Replanning checks current state before proposing remaining changes; it does not roll back earlier changes or replay database setup.\nFor Azure Storage 403 errors, resource-management access and Blob data access are separate. A newly created Blob data role can take time to authorize requests. Check the deployment identity's Blob data permissions and applicable network rules and policy; do not enable shared keys to bypass denied access.\nState locks, ownership checks, and deletion/replacement guards remain enforced. Cleanup/destroy failures require the existing recovery procedure rather than this retry menu.\nScroll to inspect the output, then press Enter to return to recovery choices. This does not retry the step.",
    "purpose": "Shows the full local Terraform error with state-aware and Storage-403 guidance.",
    "decision": "Enter returns to the recovery menu. It does not retry, unlock state or bypass access policy.",
    "consequence": "Management-plane roles and Blob data roles differ; allow propagation and review policy rather than enabling shared keys.",
    "phase": "provision",
    "columns": 112,
    "rows": 44,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Apply Terraform changes failed (exit code 1).\nTerraform may have applied some changes. Retry prepares a fresh plan for review; it does not restart setup.\nIf access was just granted, allow permission propagation and check data permissions, network rules, and policy before retrying."
    }
  },
  {
    "id": "preparing-a-fresh-terraform-plan",
    "group": "Terraform step recovery",
    "title": "Preparing a fresh Terraform plan",
    "source": "infrastructure/terraform/index.ts:118",
    "kind": "progress",
    "message": "Preparing a fresh Terraform plan for review.",
    "purpose": "Communicates that retry starts with current state, not the previous failed plan.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The next changed plan needs another explicit Apply confirmation; a no-change plan can proceed without a question.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "info",
      "message": "Preparing a fresh Terraform plan for review."
    }
  },
  {
    "id": "fresh-remaining-terraform-changes",
    "group": "Terraform step recovery",
    "title": "Fresh remaining Terraform changes",
    "source": "infrastructure/terraform/index.ts:90",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Shows only remaining changes after a synthetic partial apply.",
    "decision": "Yes applies this new plan; No is the default and stops.",
    "consequence": "Earlier successfully created resources are retained. Idempotence depends on matching configuration and Terraform state.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_storage_blob.release_lock"
    }
  },
  {
    "id": "terraform-destructive-plan-blocked",
    "group": "Terraform step recovery",
    "title": "Terraform destructive plan blocked",
    "source": "infrastructure/terraform/index.ts:74",
    "kind": "shell",
    "message": "Error: Terraform plan blocked: it deletes or replaces existing resources.\ndelete/create azurerm_postgresql_flexible_server.hub (replacement attributes: zone)\nNo changes from this plan were applied. Review the Terraform configuration and state before retrying.\n\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json. Restart setup to resume.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Shows the fail-closed result when a normal plan proposes deleting or replacing persistent resources.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "No proposed change is applied. Review the module and state outside the retry loop; the normal wizard does not offer a destructive override.",
    "phase": "configure",
    "columns": 112,
    "rows": 28,
    "welcome": false
  },
  {
    "id": "retained-installation-lock-choices",
    "group": "Operational lock recovery",
    "title": "Retained installation lock choices",
    "source": "infrastructure/azure/install/lease/recover/index.ts:106",
    "kind": "select",
    "message": "How would you like to handle the deployment lock?",
    "purpose": "Detects an infinite retained operational lease, which may be owned by another active deployment.",
    "decision": "Recheck without clearing, request safety checks before clearing, or exit.",
    "consequence": "Age alone never makes clearing safe. Selecting Clear first inspects; it does not immediately break the lease.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222\nAnother deployment or an interrupted run may own this lock; age alone does not make it safe to clear.\nTo clear it and continue, the wizard checks safety first, then asks for confirmation. Resources and saved progress are kept."
    },
    "options": [
      {
        "label": "Recheck without clearing the lock",
        "value": "0"
      },
      {
        "label": "Clear lock and continue (after safety checks)",
        "value": "1"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "2"
      }
    ]
  },
  {
    "id": "retained-release-lock-choices",
    "group": "Operational lock recovery",
    "title": "Retained release lock choices",
    "source": "infrastructure/azure/install/lease/recover/index.ts:106",
    "kind": "select",
    "message": "How would you like to handle the deployment lock?",
    "purpose": "Uses the same recovery UI for the second known operational lease.",
    "decision": "Recheck, request checked recovery, or exit. Inspect the displayed coordinates carefully.",
    "consequence": "This variant targets releases/deployment.lock in the application storage account, not installer.lock or Terraform state.",
    "phase": "release",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicademohub/releases/deployment.lock\nSubscription: 22222222-2222-4222-8222-222222222222\nAnother deployment or an interrupted run may own this lock; age alone does not make it safe to clear.\nTo clear it and continue, the wizard checks safety first, then asks for confirmation. Resources and saved progress are kept."
    },
    "options": [
      {
        "label": "Recheck without clearing the lock",
        "value": "0"
      },
      {
        "label": "Clear lock and continue (after safety checks)",
        "value": "1"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "2"
      }
    ]
  },
  {
    "id": "finite-changing-or-unknown-lease",
    "group": "Operational lock recovery",
    "title": "Finite changing or unknown lease",
    "source": "infrastructure/azure/install/lease/recover/index.ts:106",
    "kind": "select",
    "message": "How would you like to handle the deployment lock?",
    "purpose": "Suppresses operational recovery if the lease is not a known infinite retained lease.",
    "decision": "Recheck without clearing or exit. No Clear or Stop Hub choice is available.",
    "consequence": "Wait for the owner to finish or inspect the lease through authorized tooling.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222\nThis lease is finite, changing, or unknown. Recovery is not available; wait for its owner to finish or review its state before rechecking."
    },
    "options": [
      {
        "label": "Recheck without clearing the lock",
        "value": "0"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "1"
      }
    ]
  },
  {
    "id": "lease-inspection-could-not-be-verified",
    "group": "Operational lock recovery",
    "title": "Lease inspection could not be verified",
    "source": "infrastructure/azure/install/lease/recover/index.ts:69",
    "kind": "select",
    "message": "Recovery could not be verified for replicastatedemo/terraform/replica-demo/installer.lock. Azure did not return lease metadata. No lock was cleared.\nDo not assume the lock was cleared. Recheck its current state before continuing.",
    "purpose": "Keeps a failed or unreadable lease inspection visible instead of implying recovery succeeded.",
    "decision": "Recheck the lock or exit with saved progress.",
    "consequence": "No clearing or Hub shutdown can be based on stale evidence; a successful new inspection is required.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Recovery could not be verified for replicastatedemo/terraform/replica-demo/installer.lock. Azure did not return lease metadata. No lock was cleared.\nDo not assume the lock was cleared. Recheck its current state before continuing."
    },
    "options": [
      {
        "label": "Recheck the lock",
        "value": "0"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "1"
      }
    ]
  },
  {
    "id": "inspecting-recovery-safety",
    "group": "Operational lock recovery",
    "title": "Inspecting recovery safety",
    "source": "infrastructure/azure/install/lease/inspect/index.ts:41",
    "kind": "progress",
    "message": "Checking provisioning/setup executions and Hub revisions",
    "purpose": "Shows the two-part read-only inspection of Terraform state, ownership, job executions and every Hub revision/replica.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "This spinner can legitimately recur after consent because evidence must be refreshed before mutations.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Checking Terraform state locks and installation ownership",
      "Checking provisioning/setup executions and Hub revisions"
    ]
  },
  {
    "id": "terraform-state-still-locked",
    "group": "Operational lock recovery",
    "title": "Terraform state still locked",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nTerraform state replica-demo/app.tfstate is locked or its status is unknown. Wait for Terraform to finish, or review its recovery separately. The wizard never force-unlocks Terraform state.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Separates a Terraform state lease from the wizard's recoverable operational leases.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "The wizard never force-unlocks Terraform state. A running or unknown Terraform lock prevents Hub shutdown and operational clearing.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "setup-or-provisioning-execution-active",
    "group": "Operational lock recovery",
    "title": "Setup or provisioning execution active",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nJob replica-demo-setup, execution replica-demo-setup-demo, is Running. In Azure portal > Container Apps Jobs > replica-demo-setup > Execution history, wait for or explicitly stop it before rechecking.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Names the job and exact execution preventing safe recovery.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "The operator must wait for or explicitly stop the execution through authorized Azure tooling. This wizard action never cancels jobs.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "verified-hub-activity-is-sole-blocker",
    "group": "Operational lock recovery",
    "title": "Verified Hub activity is sole blocker",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nRevision replica-demo-hub--demo is active. Hub must enter an approved maintenance window before clearing this lock.\n\nRevision replica-demo-hub--demo still has 1 replica(s). Wait for every replica to stop, including replicas of inactive revisions, before rechecking.\n\nChoose controlled Hub shutdown, recheck safety, or exit and keep saved progress.",
    "purpose": "Offers a corrective action only after the exact owned Hub is verified and no state/job/ownership blocker remains.",
    "decision": "Choose the guarded Hub shutdown action, recheck safety, or exit.",
    "consequence": "This choice opens a separate downtime-and-attestation prompt. It is not consent to clear the lock.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Stop Hub for recovery and continue",
        "value": "stop-hub"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "authorize-guarded-hub-downtime",
    "group": "Operational lock recovery",
    "title": "Authorize guarded Hub downtime",
    "source": "infrastructure/azure/install/lease/recover/index.ts:154",
    "kind": "confirm",
    "message": "Authorize downtime for Hub replica-demo-hub in resource group replica-demo-hub, subscription 22222222-2222-4222-8222-222222222222?\nVerified app: /subscriptions/22222222-2222-4222-8222-222222222222/resourceGroups/replica-demo-hub/providers/Microsoft.App/containerApps/replica-demo-hub\nDeactivate its active revisions and wait for every old replica to stop. No app or database will be deleted, and no setup/provisioning job will be cancelled.\nConfirm that all previous installer, Terraform, and release processes have stopped, including other terminals, machines, and CI. Also confirm that old provisioning/setup/migration database sessions have ended and that partial migrations, database ownership, and temporary provisioning grants have been reviewed.\nThe lock at replicastatedemo/terraform/replica-demo/installer.lock will remain retained until a separate clearing confirmation. Hub may remain stopped if later recovery fails or is cancelled.",
    "purpose": "Combines exact resource identity, downtime consequences and operator-only process/database attestations.",
    "decision": "Yes authorizes deactivation and draining of this verified Hub; No is the default. Attest that other installer/Terraform/release processes and old database sessions have stopped.",
    "consequence": "No app or database is deleted and no job is cancelled. The lock remains retained pending a separate clearing approval. Hub can remain offline if later steps fail.",
    "phase": "provision",
    "columns": 112,
    "rows": 44,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    }
  },
  {
    "id": "draining-verified-hub-replicas",
    "group": "Operational lock recovery",
    "title": "Draining verified Hub replicas",
    "source": "infrastructure/azure/install/lease/recover/index.ts:181",
    "kind": "progress",
    "message": "Deactivating verified Hub revisions and waiting up to five minutes for replicas",
    "purpose": "Shows the bounded wait after explicit shutdown consent.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "All old replicas, including inactive-revision replicas, must stop. The helper has a five-minute deadline; partial shutdown is not success.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "history": [
      "Checking provisioning/setup executions and Hub revisions",
      "Deactivating verified Hub revisions and waiting up to five minutes for replicas"
    ]
  },
  {
    "id": "separate-operational-lock-clearing-approval",
    "group": "Operational lock recovery",
    "title": "Separate operational lock clearing approval",
    "source": "infrastructure/azure/install/lease/recover/index.ts:228",
    "kind": "confirm",
    "message": "Confirm that all previous installer, Terraform, and release processes have stopped, including other terminals, machines, and CI. Also confirm that old provisioning/setup/migration database sessions have ended and that partial migrations, database ownership, and temporary provisioning grants have been reviewed using the installation recovery guide.\nClear only the deployment lock at replicastatedemo/terraform/replica-demo/installer.lock in subscription 22222222-2222-4222-8222-222222222222? Resources and saved progress will be kept. This does not repair or replay database work.",
    "purpose": "Asks for the final human attestation after Azure safety checks have passed.",
    "decision": "Yes permits breaking only the displayed operational lease; No is the default and retains it.",
    "consequence": "Fresh safety and lease metadata are checked again after consent. This neither repairs nor replays database work; resources and saved progress stay.",
    "phase": "provision",
    "columns": 112,
    "rows": 44,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Azure checks found no locked Terraform state, active job executions, or running Hub revisions/replicas. Azure cannot prove that a deployment process on another machine has stopped or that old database sessions have ended."
    }
  },
  {
    "id": "recovery-consent-declined",
    "group": "Operational lock recovery",
    "title": "Recovery consent declined",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nRecovery was not authorized. The lock and saved progress are unchanged.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Explains that declining clearing consent leaves the installation untouched.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "Rechecking is useful only after the operator has resolved a blocker or intends to review fresh evidence.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "shutdown-consent-declined",
    "group": "Operational lock recovery",
    "title": "Shutdown consent declined",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nHub shutdown was not authorized. The wizard did not stop Hub or clear the lock.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Reports a declined downtime request without implying Hub stopped.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "The wizard did not stop Hub or clear the lock. A new inspection is needed before offering a corrective action again.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "conditions-changed-during-shutdown-consent",
    "group": "Operational lock recovery",
    "title": "Conditions changed during shutdown consent",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nHub shutdown was not started. The lease or recovery conditions changed during consent.\n\nJob replica-demo-setup, execution replica-demo-setup-new, is Running.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Cancels a proposed shutdown if reviewed evidence becomes stale.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "Hub shutdown is not started. The operator must review the new execution or lease state before trying again.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "evidence-changed-during-clearing-review",
    "group": "Operational lock recovery",
    "title": "Evidence changed during clearing review",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nThe installation changed during review. Review it again.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Represents a safety recheck that detects a changed job/revision/replica or database-review context.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "The old approval is not reused. No lock is cleared until a new inspection and consent pass.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "lease-changed-during-clearing-review",
    "group": "Operational lock recovery",
    "title": "Lease changed during clearing review",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nThe lease changed during review. The wizard did not clear it. Recheck before taking any action.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Refuses to clear a lease that is no longer the reviewed infinite retained lease.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "Do not repeat a prior break command manually; inspect the current lease and owner.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "hub-shutdown-incomplete-or-failed",
    "group": "Operational lock recovery",
    "title": "Hub shutdown incomplete or failed",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nHub shutdown did not complete. Hub may be partially or fully stopped. No lock-clearing command was issued; inspect the current state before retrying.\n\nRecovery could not be verified for replicastatedemo/terraform/replica-demo/installer.lock. Azure did not return lease metadata. No lock was cleared.\nDo not assume the lock was cleared. Recheck its current state before continuing.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Reports that shutdown may have partially changed Hub activity but did not authorize lock clearing.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "Inspect the exact Hub state before retrying. No lock-clearing command was issued by the failed shutdown path.",
    "phase": "provision",
    "columns": 112,
    "rows": 44,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "recovery-after-hub-has-already-stopped",
    "group": "Operational lock recovery",
    "title": "Recovery after Hub has already stopped",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nHub shutdown completed earlier in this recovery attempt. Hub can remain offline until a release succeeds; recovery does not restart it.\n\nThe deployment lock was not cleared.\n\nThe installation changed during review. Review it again.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Keeps downtime visible if a later recovery check or consent stops progress.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "Exiting or rechecking does not restart Hub. Recovery is not a rollback or availability-restoration action.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "ambiguous-lock-break-outcome",
    "group": "Operational lock recovery",
    "title": "Ambiguous lock break outcome",
    "source": "infrastructure/azure/install/lease/recover/index.ts:278",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nRecovery could not be verified for replicastatedemo/terraform/replica-demo/installer.lock. Azure did not return lease metadata. No lock was cleared.\nDo not assume the lock was cleared. Recheck its current state before continuing.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Represents an Azure break request whose result cannot be confirmed.",
    "decision": "Recheck safety/current lease state or exit. Never assume that the lock is either cleared or still held.",
    "consequence": "A later read, not the command's apparent success, must establish the current lease state.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "lock-acquisition-race-or-access-failure",
    "group": "Operational lock recovery",
    "title": "Lock acquisition race or access failure",
    "source": "infrastructure/azure/install/lease/index.ts:82",
    "kind": "select",
    "message": "The deployment lock could not be acquired.",
    "purpose": "Handles a failure to acquire the operational lease after inspection.",
    "decision": "Recheck and retry lock acquisition, or exit. This acquisition attempt did not itself break a lease.",
    "consequence": "Access may have failed or another deployment may have acquired the lease. Recovery checks run again before retrying acquisition.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "error",
      "message": "Could not acquire the lease at replicastatedemo/terraform/replica-demo/installer.lock. No lease was broken by this acquisition attempt. Check access and whether another deployment or retained lease owns it; follow the installation recovery guide before retrying.\nAzure lease acquisition returned a conflict."
    },
    "options": [
      {
        "label": "Recheck and retry lock acquisition",
        "value": "0"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "1"
      }
    ]
  },
  {
    "id": "lock-cleared-and-setup-continues",
    "group": "Operational lock recovery",
    "title": "Lock cleared and setup continues",
    "source": "infrastructure/azure/install/lease/recover/index.ts:278",
    "kind": "progress",
    "message": "Cleared the deployment lock at replicastatedemo/terraform/replica-demo/installer.lock. Continuing with setup.",
    "purpose": "Shows the positive notice only after a read confirms the selected lease is unlocked.",
    "decision": "No answer is required. Ctrl+C requests a safe stop; it is not a rollback.",
    "consequence": "The notice can be brief because setup continues. It applies only to the displayed operational lease, not all locks.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "success",
      "message": "Cleared the deployment lock at replicastatedemo/terraform/replica-demo/installer.lock. Continuing with setup."
    }
  },
  {
    "id": "unverified-or-unrelated-app-prevents-shutdown",
    "group": "Operational lock recovery",
    "title": "Unverified or unrelated app prevents shutdown",
    "source": "infrastructure/azure/install/lease/recover/index.ts:107",
    "kind": "select",
    "message": "Deployment lock recovery did not complete.\n\nThe deployment lock was not cleared.\n\nAutomatic shutdown is unavailable for unverified-workload until ownership, Terraform state, and job safety checks pass. The wizard does not stop unrelated or unverified apps; review those workloads separately.\n\nResolve the reported issue before rechecking, or exit and keep saved progress.",
    "purpose": "Shows the non-eligible ownership or unrelated-workload recovery path.",
    "decision": "Resolve the named blocker, then recheck; or exit with progress preserved.",
    "consequence": "No Stop Hub choice is offered. Verify resource ownership, state and job safety outside the wizard before rechecking.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Deployment lock: replicastatedemo/terraform/replica-demo/installer.lock\nSubscription: 22222222-2222-4222-8222-222222222222"
    },
    "options": [
      {
        "label": "Recheck safety before clearing the lock",
        "value": "retry"
      },
      {
        "label": "Exit and keep saved progress",
        "value": "exit"
      }
    ]
  },
  {
    "id": "clearing-approval-before-app-resources-exist",
    "group": "Operational lock recovery",
    "title": "Clearing approval before app resources exist",
    "source": "infrastructure/azure/install/lease/recover/index.ts:228",
    "kind": "confirm",
    "message": "Confirm that all previous installer, Terraform, and release processes have stopped, including other terminals, machines, and CI.\nClear only the deployment lock at replicastatedemo/terraform/replica-demo/installer.lock in subscription 22222222-2222-4222-8222-222222222222? Resources and saved progress will be kept. This does not repair or replay database work.",
    "purpose": "Shows the shorter lock-clearing consent when no application resource group exists and database review is not applicable.",
    "decision": "Attest that prior installer/Terraform/release processes have stopped; Yes clears only the named operational lease after a fresh check. No is the default.",
    "consequence": "The absence of app resources is verified, not assumed from the draft stage. Cloud process ownership still requires operator attestation.",
    "phase": "provision",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Azure checks found no locked Terraform state, active job executions, or running Hub revisions/replicas. Azure cannot prove that a deployment process on another machine has stopped."
    }
  },
  {
    "id": "cli-help-and-automation-entry",
    "group": "Shell output and exit states",
    "title": "CLI help and automation entry",
    "source": "infrastructure/installer/index.tsx:27",
    "kind": "shell",
    "message": "Usage: npm run setup:server -- [--config FILE] [--configure-only] [--no-fullscreen]\nConfig paths are relative to infrastructure/ when using the root shortcut.\nInteractive progress is saved in a private companion draft; restart to resume.\nAutomation: --config FILE --non-interactive --approve-deployment\nApproval includes billable resources, role assignments, image publication, temporary provisioning cleanup, and a maintenance-window release.",
    "purpose": "Documents the interactive, configure-only, inline and explicitly approved automation entry points.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Relative --config paths use infrastructure/ with the root npm shortcut. Automation is not the interactive recovery flow.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "non-interactive-invocation-missing-approval",
    "group": "Shell output and exit states",
    "title": "Non-interactive invocation missing approval",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "shell",
    "message": "Error: Non-interactive deployment requires --config, --approve-deployment, and an existing complete configuration.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Fails early unless automation supplies a complete existing config and explicit approval.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "No interactive recovery questions are available. --configure-only is not accepted with this automation mode.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "wizard-started-without-a-tty",
    "group": "Shell output and exit states",
    "title": "Wizard started without a TTY",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "shell",
    "message": "Error: Use a terminal for the wizard, or supply --non-interactive with explicit configuration and approval.",
    "purpose": "Explains why a piped or non-terminal interactive invocation cannot run the TUI.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Use a real terminal or the explicit non-interactive configuration-and-approval path.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "another-local-setup-session-owns-the-draft",
    "group": "Shell output and exit states",
    "title": "Another local setup session owns the draft",
    "source": "infrastructure/installer/session/lock/index.ts:13",
    "kind": "shell",
    "message": "Error: Another setup session owns /demo/replica/infrastructure/.local/installation.json.draft.json.lock. Close that session before retrying. Do not remove Azure installation or release locks.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Protects local session writing independently of Azure installation and release leases.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Close the owning setup process first. Removing cloud leases is not a remedy for a local writer lock.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "existing-target-or-owner-changed",
    "group": "Shell output and exit states",
    "title": "Existing target or owner changed",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "shell",
    "message": "Error: The saved installation target or owner changed. Use a new --config file for another installation; existing configuration was not overwritten.\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Stops attempted retargeting of an existing installation and avoids overwriting its saved config.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Use another --config path for a different installation. The existing target is not silently migrated.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "existing-resources-lack-matching-terraform-state",
    "group": "Shell output and exit states",
    "title": "Existing resources lack matching Terraform state",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "shell",
    "message": "Error: The app group exists without matching Terraform state. Review import/recovery first.\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Represents fail-closed ownership/state errors rather than an adoption wizard.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Review import or recovery manually. Foundation-group state mismatches use the same shell error family.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "ambiguous-prior-database-provisioning",
    "group": "Shell output and exit states",
    "title": "Ambiguous prior database provisioning",
    "source": "infrastructure/azure/install/provision/index.ts:106",
    "kind": "shell",
    "message": "Error: Database provisioning has prior executions but no completion marker. Inspect the database and exact job execution; do not rerun fresh-database provisioning blindly.\nLock retained at replicademohub/releases/deployment.lock.\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Stops a database setup whose prior execution outcome is not proven by a completion marker.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Inspect the exact job, database state, ownership and grants. Re-running fresh provisioning blindly is unsafe.",
    "phase": "configure",
    "columns": 112,
    "rows": 28,
    "welcome": false
  },
  {
    "id": "release-failure-with-retained-lock-guidance",
    "group": "Shell output and exit states",
    "title": "Release failure with retained lock guidance",
    "source": "infrastructure/installer/terminal/shell/index.tsx",
    "kind": "shell",
    "message": "Error: Run the maintenance-window release failed (exit code 1).\nRelease failed. Review replicademohub/releases/deployment.lock and the installation lease before retrying.\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json. Restart setup to resume. Review retained cloud leases before retrying an interrupted deployment.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Combines a representative command failure, persistent recovery warning, retained draft and local diagnostics path.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "A failed release can leave Hub offline and leases retained. The normal-shell error is not proof of rollback.",
    "phase": "configure",
    "columns": 112,
    "rows": 28,
    "welcome": false
  },
  {
    "id": "user-cancellation-and-preserved-draft",
    "group": "Shell output and exit states",
    "title": "User cancellation and preserved draft",
    "source": "infrastructure/installer/index.tsx:149",
    "kind": "shell",
    "message": "Error: Installation cancelled. Your draft is retained; check any retained cloud locks before retrying.\nSession preserved at /demo/replica/infrastructure/.local/installation.json.draft.json. Restart setup to resume. Review retained cloud leases before retrying an interrupted deployment.\nSetup diagnostics: /demo/logs/setup.jsonl",
    "purpose": "Shows the restored-shell cancellation surface following Ctrl+C.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "Interactive interruption normally exits with code 130. Saved progress remains; cloud effects already completed are not undone.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "cleanup-or-diagnostics-could-not-finish",
    "group": "Shell output and exit states",
    "title": "Cleanup or diagnostics could not finish",
    "source": "infrastructure/installer/index.tsx:127",
    "kind": "shell",
    "message": "Terminal cleanup failed. Restore your terminal before retrying setup.\nLocal session writer cleanup failed. Review the local writer record before retrying.\nCould not finish saving installer diagnostics. The local log may be incomplete.\nError: Representative cleanup failure.",
    "purpose": "Catalogs the three cleanup-warning lines in one synthetic combined shell state.",
    "decision": "Read the result in the restored shell; there is no form input.",
    "consequence": "These warnings can occur independently. Do not infer success if cleanup failed; restore the terminal or inspect the local writer record.",
    "phase": "configure",
    "columns": 112,
    "rows": 24,
    "welcome": false
  },
  {
    "id": "compact-welcome-in-narrow-terminal",
    "group": "Responsive and alternate terminal modes",
    "title": "Compact welcome in narrow terminal",
    "source": "infrastructure/installer/terminal/shell/index.tsx:53",
    "kind": "cloud",
    "message": "",
    "purpose": "Shows the compact Octocat treatment when expanded art cannot fit.",
    "decision": "Same Azure-only choice and keyboard behavior as the wide welcome.",
    "consequence": "The actual component selects artwork by terminal dimensions. This is a true 71-column capture, not a scaled wide screen.",
    "phase": "cloud",
    "columns": 71,
    "rows": 30,
    "welcome": true
  },
  {
    "id": "short-terminal-without-artwork",
    "group": "Responsive and alternate terminal modes",
    "title": "Short terminal without artwork",
    "source": "infrastructure/installer/terminal/shell/index.tsx:52",
    "kind": "cloud",
    "message": "",
    "purpose": "Shows startup in a terminal too small for welcome art.",
    "decision": "Choose Azure or cancel; the missing artwork is intentional.",
    "consequence": "The greeting is suppressed below its 60-column / 24-row art threshold.",
    "phase": "cloud",
    "columns": 60,
    "rows": 22,
    "welcome": true
  },
  {
    "id": "very-small-resized-terminal",
    "group": "Responsive and alternate terminal modes",
    "title": "Very small resized terminal",
    "source": "infrastructure/installer/terminal/shell/index.tsx:51",
    "kind": "field",
    "message": "",
    "purpose": "Shows the minimal header/footer treatment after resizing an already full-screen wizard.",
    "decision": "Edit the active answer or use PgUp/PgDn to reveal content.",
    "consequence": "This is a resized-state fixture: a session initially this small starts inline instead of full-screen.",
    "phase": "configure",
    "columns": 52,
    "rows": 9,
    "welcome": false,
    "field": "name",
    "initial": "replica-demo"
  },
  {
    "id": "inline-no-fullscreen-mode",
    "group": "Responsive and alternate terminal modes",
    "title": "Inline no-fullscreen mode",
    "source": "infrastructure/installer/terminal/index.tsx:24",
    "kind": "field",
    "message": "",
    "purpose": "Shows the shared controls without alternate-screen layout or art.",
    "decision": "Same field validation and Ctrl+C behavior; ordinary shell scrollback is used.",
    "consequence": "Used by --no-fullscreen, TERM=dumb, screen-reader flag, or an initially too-small terminal. This capture shows inline rendering, not assistive-technology testing.",
    "phase": "configure",
    "columns": 90,
    "rows": 16,
    "welcome": false,
    "fullscreen": false,
    "field": "name",
    "initial": "replica-demo"
  },
  {
    "id": "configure-only-progress-path",
    "group": "Responsive and alternate terminal modes",
    "title": "Configure-only progress path",
    "source": "infrastructure/installer/terminal/progress/index.tsx:1",
    "kind": "field",
    "message": "",
    "purpose": "Shows the shortened phase tracker for a configuration-only session.",
    "decision": "Complete the same validated configuration questions.",
    "consequence": "The path ends at Review; no provision/release/verify phase is presented.",
    "phase": "configure",
    "columns": 112,
    "rows": 38,
    "welcome": false,
    "configureOnly": true,
    "field": "owner",
    "initial": "design-team"
  },
  {
    "id": "long-plan-first-viewport",
    "group": "Responsive and alternate terminal modes",
    "title": "Long plan first viewport",
    "source": "infrastructure/installer/terminal/scroll-panel/index.tsx:1",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Shows how a long plan summary is clipped within the scrollable content panel.",
    "decision": "PgDn moves through the warning to the confirmation controls below; default approval remains No.",
    "consequence": "This synthetic long-plan fixture documents the scroll affordance. It is not a real module plan.",
    "phase": "provision",
    "columns": 112,
    "rows": 24,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_role_assignment.sample_01\ncreate azurerm_role_assignment.sample_02\ncreate azurerm_role_assignment.sample_03\ncreate azurerm_role_assignment.sample_04\ncreate azurerm_role_assignment.sample_05\ncreate azurerm_role_assignment.sample_06\ncreate azurerm_role_assignment.sample_07\ncreate azurerm_role_assignment.sample_08\ncreate azurerm_role_assignment.sample_09\ncreate azurerm_role_assignment.sample_10\ncreate azurerm_role_assignment.sample_11\ncreate azurerm_role_assignment.sample_12\ncreate azurerm_role_assignment.sample_13\ncreate azurerm_role_assignment.sample_14\ncreate azurerm_role_assignment.sample_15\ncreate azurerm_role_assignment.sample_16\ncreate azurerm_role_assignment.sample_17\ncreate azurerm_role_assignment.sample_18\ncreate azurerm_role_assignment.sample_19\ncreate azurerm_role_assignment.sample_20\ncreate azurerm_role_assignment.sample_21\ncreate azurerm_role_assignment.sample_22\ncreate azurerm_role_assignment.sample_23\ncreate azurerm_role_assignment.sample_24\ncreate azurerm_role_assignment.sample_25\ncreate azurerm_role_assignment.sample_26\ncreate azurerm_role_assignment.sample_27\ncreate azurerm_role_assignment.sample_28"
    }
  },
  {
    "id": "long-plan-after-page-down",
    "group": "Responsive and alternate terminal modes",
    "title": "Long plan after Page Down",
    "source": "infrastructure/installer/terminal/scroll-panel/index.tsx:39",
    "kind": "confirm",
    "message": "Apply these Terraform changes?",
    "purpose": "Captures the same long-plan screen after a real Page Down key event.",
    "decision": "Review the final addresses, then explicitly choose Yes or No.",
    "consequence": "The phase bar and safe-stop footer remain visible as content scrolls.",
    "phase": "provision",
    "columns": 112,
    "rows": 24,
    "welcome": false,
    "notice": {
      "level": "warning",
      "message": "Terraform changes:\ncreate azurerm_role_assignment.sample_01\ncreate azurerm_role_assignment.sample_02\ncreate azurerm_role_assignment.sample_03\ncreate azurerm_role_assignment.sample_04\ncreate azurerm_role_assignment.sample_05\ncreate azurerm_role_assignment.sample_06\ncreate azurerm_role_assignment.sample_07\ncreate azurerm_role_assignment.sample_08\ncreate azurerm_role_assignment.sample_09\ncreate azurerm_role_assignment.sample_10\ncreate azurerm_role_assignment.sample_11\ncreate azurerm_role_assignment.sample_12\ncreate azurerm_role_assignment.sample_13\ncreate azurerm_role_assignment.sample_14\ncreate azurerm_role_assignment.sample_15\ncreate azurerm_role_assignment.sample_16\ncreate azurerm_role_assignment.sample_17\ncreate azurerm_role_assignment.sample_18\ncreate azurerm_role_assignment.sample_19\ncreate azurerm_role_assignment.sample_20\ncreate azurerm_role_assignment.sample_21\ncreate azurerm_role_assignment.sample_22\ncreate azurerm_role_assignment.sample_23\ncreate azurerm_role_assignment.sample_24\ncreate azurerm_role_assignment.sample_25\ncreate azurerm_role_assignment.sample_26\ncreate azurerm_role_assignment.sample_27\ncreate azurerm_role_assignment.sample_28"
    },
    "inputs": [
      "\u001b[6~"
    ]
  }
]

export const sourceBindings: Record<string, string> = {
  "infrastructure/installer/wizard/index.ts": "cb0bc6ccb3cc52d2ef18625efc74dab18012d28d1d3cf7ef02ffbbaab442dab1",
  "infrastructure/installer/session/lock/index.ts": "02a5cf77649308c8b5b295d624638e54c2842acfda29db440377a45320f29078",
  "infrastructure/azure/install/preflight/index.ts": "a7b835c5886b78b8bf03efab321bf7bdc769422e815234867a14cf5a181975d7",
  "infrastructure/azure/install/configure/index.ts": "fba25677a3c9bee1b813eb672c894b83678a21fc93336501b7b89f771787a97e",
  "infrastructure/installer/config/fields/index.ts": "f936a98350a6cd093b7b1fd1ec092ac82b2849a2a95ff13ed60e28d5b8e3df38",
  "infrastructure/azure/install/index.ts": "e979b00e6cb9276ba3fc93be1ae8c5153e820401121302302ef29fbd145e741c",
  "infrastructure/azure/install/backend/index.ts": "223e80bc84447ee1f47e44d6e4c7aa7702b895849f228c4793cacd6c062170e5",
  "infrastructure/terraform/index.ts": "bb81895279879a78c3f7671704cfc762d03f735d15ecb5e08a5d616b2a868252",
  "infrastructure/azure/install/secrets/index.ts": "40243a4dec330344ec6d54cb945cec89f0f9342b30d5cf0960a246fb1ca36f9d",
  "infrastructure/azure/install/image/index.ts": "c2118d1837b133ac8b90a6bd6cb27df3dc795cc6acfa42b91c65b4bb491017ff",
  "infrastructure/azure/install/provision/index.ts": "f2edc025c8435e30ff475ef952e19c849ce604c96bd89a78f94abcb2616fd65e",
  "infrastructure/installer/deployment-summary/index.ts": "1adabb9e093d0396210351a78457f77db974d4dadb5b346afe0c3f6b0423e9d2",
  "infrastructure/installer/prompt-for-recovery/index.ts": "a38f6d5c4f56abb996d1fd05b75869087527a1fd3dcb62537a5d7efb1e679a98",
  "infrastructure/azure/install/lease/recover/index.ts": "375248ee671e21b88638815882680666764572d8bd5d0158fc2b78b4b7e4886c",
  "infrastructure/azure/install/lease/inspect/index.ts": "1b06bc38a2415b35639f52f94688f577844840e697496291cbbcd52dbc51b89d",
  "infrastructure/azure/install/lease/index.ts": "48754874070fab3a6a051ec7e3bf90dba3cfe1072f89cf505a95e027765914ef",
  "infrastructure/installer/index.tsx": "5ce37365270346b879d865b36bd800c06f52885ea7200f6fe68637901df91212"
}
