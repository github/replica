# Prepare an Azure VM for Hub

This guide adds Azure networking, DNS, and automatic HTTPS to the [manual VM installation](manual-vm-installation.md). Hub still uses the normal image and Compose bundle. It runs once on persistent local storage; this is not an Azure Files, Container Apps, or high-availability deployment.

You need permission to create the VM and public DNS zone, assign a role at that zone, and add delegation at the parent domain's existing DNS provider. Use the Azure portal; Azure CLI and a container registry of your own are not required.

## Choose your values

Replace the example domain and every `REPLACE_WITH_...` field. Do not commit the completed files or resource identifiers.

| Value | Example or source |
| --- | --- |
| Dedicated registered domain | `example.com`, reserved entirely for Hub and previews |
| Hub hostname and Azure child DNS zone | `hub.example.com` |
| Preview wildcard | `*.preview.hub.example.com` |
| VM resource group/name | Your approved resource names |
| VM public IP | Static IPv4 from the VM's Overview |
| DNS subscription ID/resource group | The child DNS zone's Overview, which may differ from the VM's |
| Certificate contact | An actual team-monitored email address |
| Caddy and Azure plugin versions | Reviewed exact releases chosen by your operator |

This example delegates `hub.example.com` while leaving `example.com` at its existing provider. Delegation does not satisfy [domain isolation](deployment.md#choose-an-isolated-domain) if unrelated applications use the same registered domain.

## Create the VM and network rules

In **Azure portal -> Virtual machines -> Create**, choose an approved subscription, region, and supported Ubuntu Server LTS image. Use an x64 or ARM64 VM matching the selected Hub image. A modest VM can establish the installation flow; choose production CPU, memory, and disk from workload measurements.

Use SSH public-key authentication, a Standard static public IP, and a persistent managed OS disk. Disable **Delete with VM** for persistent disks and enable **System assigned managed identity**. Do not use an ephemeral OS disk or Azure's temporary `/mnt` disk for Docker or Hub data.

Configure the network security group:

| Port | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Approved administrator CIDRs, or use approved Bastion access | SSH |
| TCP 80 | Internet | HTTPS redirects |
| TCP 443 | Internet | Hub, previews, callbacks, and webhooks |

Leave ports 3000, 2019, and Docker's API closed. Permit outbound DNS, time synchronization, package/image downloads, GitHub, Azure identity/management, and certificate authorities according to your network policy. Review charges for compute, disks, IP, DNS, traffic, and backup.

Verify the VM's SSH host key before your first connection. Azure **Run command -> RunShellScript** can print public host-key fingerprints:

```sh
for key in /etc/ssh/ssh_host_*_key.pub; do
  ssh-keygen -lf "$key"
done
```

Compare the key type and fingerprint with your SSH prompt. Continue the [VM installation](manual-vm-installation.md#prepare-the-vm) on that VM. For Ubuntu, use [Docker's official repository instructions](https://docs.docker.com/engine/install/ubuntu/), not a script that replaces an existing runtime.

## Delegate the child DNS zone

Create a **public DNS zone**, not a Private DNS zone or DNS Private Resolver, named `hub.example.com`. Copy its four assigned name servers from Overview. Do not reuse another zone's server names.

At the authoritative provider for `example.com`, add an NS record set named `hub` pointing to those four servers. Some providers need four separate NS entries with the same name. Do not change registrar name servers, the parent apex NS records, or unrelated records. Coordinate conflicting records before replacing anything.

For Cloudflare, use **DNS -> Records -> Add record**, choose **NS**, enter `hub` as Name, and enter one Azure server per record. These are DNS-only records; the delegated service does not pass through Cloudflare's proxy or WAF.

Inside the Azure child zone, add:

| Name | Type | Value |
| --- | --- | --- |
| `@` | A | VM static public IPv4 |
| `*.preview` | A | The same VM IPv4 |

Keep the zone's generated NS and SOA records. These A records are separate from the parent's NS delegation. Do not add AAAA records without working IPv6 routing and firewall rules.

From your computer, replace the example names and check:

```sh
nslookup -type=NS hub.example.com
nslookup -type=SOA hub.example.com
nslookup hub.example.com
nslookup b123.preview.hub.example.com
```

Require Azure's assigned NS/SOA and the VM IP for both hostnames. Allow DNS caches to expire. Any inherited CAA policy must allow your chosen certificate authority and wildcard issuance.

## Grant certificate automation access

Confirm the VM's system-assigned identity is On. Open the **child DNS zone -> Access control (IAM) -> Add role assignment**. Assign **DNS Zone Contributor** to that VM's managed identity at this **zone only**, not the resource group, subscription, or shared parent.

This permits certificate TXT-record changes within the zone. Processes that can use the VM identity can exercise those permissions too. Allow time for role propagation.

## Configure the HTTPS proxy

Standard Caddy does not include Azure DNS support. Build a separate proxy image with the [Azure DNS module](https://github.com/caddy-dns/azure). Choose reviewed exact Caddy and module versions from their release metadata and check the module's configuration for those versions.

Create `proxy/` inside the deployment directory. If files already exist, inspect and back them up instead of overwriting them. Create the following files with your editor.

`proxy/Dockerfile`:

```dockerfile
FROM caddy:REPLACE_WITH_CADDY_VERSION-builder AS builder
RUN xcaddy build vREPLACE_WITH_CADDY_VERSION \
    --with github.com/caddy-dns/azure@vREPLACE_WITH_AZURE_MODULE_VERSION

FROM caddy:REPLACE_WITH_CADDY_VERSION
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Use the same Caddy version in all three places. For example, substitute a version number without adding a second `v`. These dependencies are separate from the Hub release; retain their pins and review them when updating the proxy.

`proxy/compose.yml`:

```yaml
name: replica-proxy
services:
  caddy:
    build: .
    image: replica-caddy-azure:REPLACE_WITH_LOCAL_PROXY_TAG
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
volumes:
  caddy-data:
  caddy-config:
```

`proxy/Caddyfile`:

```caddyfile
{
    email REPLACE_WITH_CERTIFICATE_CONTACT_EMAIL
    acme_ca https://acme-v02.api.letsencrypt.org/directory
}

hub.example.com, *.preview.hub.example.com {
    tls {
        dns azure {
            subscription_id REPLACE_WITH_DNS_SUBSCRIPTION_ID
            resource_group_name REPLACE_WITH_DNS_RESOURCE_GROUP
        }
    }
    reverse_proxy 127.0.0.1:3000
}
```

Replace both hostnames and all placeholders before building or starting. Use the DNS zone's subscription ID, not its display name. An unchanged email placeholder can pass configuration parsing but fail certificate registration.

For a module version supporting this mode, omitting `tenant_id`, `client_id`, and `client_secret` selects managed identity. Do not add a personal Azure secret. Linux host networking lets Caddy reach Hub's loopback port and the VM identity endpoint; do not add `ports:` or expose Hub on `0.0.0.0`.

Once DNS and identity permissions are ready, run on the VM:

```sh
(
  set -eu
  cd "$HOME/replica-hub/proxy"
  docker compose build
  docker compose run --rm --no-deps caddy \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker compose up --detach
  docker compose ps
  docker compose logs --tail 100 caddy
)
```

Require **Valid configuration**, then check certificate issuance and public HTTPS. Validation alone proves neither Azure access nor certificate issuance. After changing an existing Caddyfile, validate first and run `docker compose restart caddy`; editing the mounted file does not reload the running server.

Keep the Caddy data/config volumes, which contain certificate and account state. Back them up as sensitive state or plan certificate reissuance. Do not delete them to retry issuance.

## Verify and operate

Return to [HTTPS and GitHub setup](manual-vm-installation.md#complete-https-and-github-setup). Verify proxy address handling through the actual public route, not only local health. Leave `REPLICA_AZURE_FRONT_DOOR_ID` unset when Front Door is not in the request path.

| Symptom | Check before changing anything |
| --- | --- |
| Azure DNS 403 | Correct VM identity, zone-scoped role, zone subscription/resource group, role propagation |
| Certificate challenge failure | Parent delegation, both A records, CAA, DNS egress |
| Invalid certificate contact | Replace the email placeholder, validate, restart Caddy |
| HTTPS timeout | Static IP, TCP 443 rule, proxy state, conflicting AAAA |
| Proxy 502 | Hub loopback health, port, and Linux host networking |
| Preview fails | Wildcard DNS/TLS and then a real Build, not only an invented name |

Use [backups](backups-and-restore.md) and [manual updates](manual-updates.md) for Hub maintenance; updating Hub does not require changing Caddy or DNS. Azure VM Backup and resource deletion locks are extra safeguards, not substitutes for consistent off-VM application backups. Do not delete the VM's disks, DNS zone, or resource group as troubleshooting.
