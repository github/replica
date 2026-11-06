const commands: Record<string, Record<string, string>> = {
  az: {
    version: "Check Azure CLI",
    "account list": "List authorized Azure subscriptions",
    "account show": "Verify the Azure deployment target",
    "account get-access-token": "Read the Azure deployment identity",
    rest: "Query Azure resource metadata",
    "provider show": "Check Azure resource provider",
    "provider register": "Register Azure resource provider",
    "group exists": "Check Azure resource group existence",
    "group show": "Read Azure resource group ownership",
    "group create": "Create Azure resource group",
    "storage account list": "List state storage accounts",
    "storage account create": "Create protected state storage",
    "storage account show": "Inspect state storage",
    "storage account update": "Update state storage access",
    "storage account blob-service-properties update": "Configure state storage recovery",
    "storage container create": "Prepare the Terraform state container",
    "storage blob exists": "Check the installation lock blob",
    "storage blob show": "Inspect the deployment lease",
    "storage blob list": "Inspect Terraform state leases",
    "storage blob upload": "Create the installation lock blob",
    "storage blob lease acquire": "Acquire the deployment lease",
    "storage blob lease release": "Release the deployment lease",
    "storage blob lease break": "Recover the selected deployment lease",
    "role assignment list": "Check Azure role assignments",
    "role assignment create": "Grant Azure resource access",
    "keyvault secret list": "Check Key Vault secret access",
    "keyvault secret show": "Read an installation secret",
    "keyvault secret set": "Store an installation secret",
    "acr login": "Sign in to the container registry",
    "containerapp job execution list": "Inspect database job executions",
    "containerapp job list": "Inspect deployment jobs",
    "containerapp list": "Inspect deployed Hub apps",
    "containerapp show": "Inspect the deployed Hub app",
    "containerapp revision list": "Inspect Hub revision activity",
    "containerapp revision show": "Inspect Hub revision activation",
    "containerapp revision activate": "Activate Hub revision",
    "containerapp revision deactivate": "Deactivate Hub revision",
    "containerapp replica list": "Inspect remaining Hub replicas",
    "containerapp job execution show": "Check database job progress",
    "containerapp job start": "Start the database job",
  },
  terraform: {
    version: "Check Terraform",
    init: "Initialize Terraform",
    "state list": "Inspect Terraform ownership",
    output: "Read Terraform outputs",
    plan: "Plan Terraform changes",
    show: "Inspect the Terraform plan",
    apply: "Apply Terraform changes",
  },
  docker: {
    info: "Check Docker",
    "buildx version": "Check Docker Buildx",
    "buildx build": "Build and publish the Hub image",
  },
  git: {
    "rev-parse": "Read the source revision",
    status: "Check the source working tree",
  },
  node: { "": "Run Node.js command" },
}

export function describeCommand(executable: string, args: string[]) {
  const tool = executable === process.execPath ? "node" : executable
  const routes = Object.hasOwn(commands, tool) ? commands[tool] : undefined
  const positional = tool === "terraform" && args[0]?.startsWith("-chdir=") ? args.slice(1) : args
  for (const [prefix, label] of Object.entries(routes ?? {})) {
    const words = prefix ? prefix.split(" ") : []
    if (words.every((word, index) => positional[index] === word)) {
      return { name: [tool, ...words].join("."), label }
    }
  }
  return { name: "other", label: "External command" }
}
