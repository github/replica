# Share links

Share links let prototype authors show one successful Build to people who do not use Replica Hub.

## Deployment opt-in

Public sharing is **off by default for new and upgraded deployments**. For example, after an upgrade an old public URL returns not found even if its original expiration is still in the future. The upgrade permanently revokes every existing link and pending preview handoff.

A Hub administrator opens **Public sharing** from the deployment security audit, or `/sharing_settings`, to enable new links. Changes require deliberate confirmation and [fresh GitHub authorization](fresh-authorization.md) on that same browser Session. Successful verification continues the confirmed change through its normal permission checks. Repository administrators and Build authors cannot change this deployment setting, and Hub administrators do not gain repository-content access.

Disabling permanently revokes all links and pending handoffs in the same transaction as the policy change and its security audit. It blocks anonymous share pages, preview authorization, cookies, files, browser routes and controls. Enabling later permits **new links only**; no revoked link returns. Signed-in previews, reviews and immutable Builds remain unchanged.

The browser sharing page explains the disabled policy instead of offering creation or remembered URLs. Canvas metadata reports `publicSharingEnabled` separately from repository-derived `canManageShareLinks`. Disabled list and mutation requests return HTTP 403 with `code: "public_sharing_disabled"` and an `errors` array. The canvas clears remembered URLs and requires a fresh context read before sharing again. The setting applies in local mode too; the local analytics demo exception does not exempt sharing.

## Creator access loss

When an uncached GitHub permission lookup successfully reports `permission: "none"` for the creator's exact immutable GitHub user ID, Hub permanently revokes **that creator's links for that repository** and its pending public handoffs. Other creators and repositories are unaffected. Regained access permits new links only.

This is an observation boundary, not continuous monitoring: repository authorization, canvas mutations, renewal and live-subscription checks may trigger an uncached lookup. Cached positive permission does not prove current access. Public visitors do not call GitHub, so their visits cannot discover creator access loss. There is no detection-latency guarantee.

Hub can reuse a repository-permission answer for up to one minute. A fresh check asks GitHub again instead of reusing it. If no reusable answer exists, Hub also asks GitHub. The main request paths use these checks as follows:

| Request or activity | When GitHub is checked |
| --- | --- |
| Ordinary signed-in repository pages, signed-in preview files, and an initial review subscription | On a permission-cache miss or expiry; a cached answer can be reused for one minute |
| Browser share-link management, including its list, create and delete requests | Every request requires a fresh answer |
| Canvas API reads | On a permission-cache miss or expiry |
| Canvas API writes, connection approval and credential renewal | Each request requires a fresh answer |
| A canvas's live review connection | On connection and every one-minute access check |
| A browser's live review connection after subscription | The periodic check verifies its Hub Session, not GitHub repository permission |
| Anonymous share pages, handoffs, cookies and preview files | No GitHub permission request; they check the saved link and current local policy |

Only a successful answer naming the expected GitHub user and explicitly reporting no repository access revokes that creator's saved links. The same answer on a cache miss or a fresh request has the same effect. See [the revocation tests](../test/models/share_link_creator_revocation_test.rb) for cached positives, fresh checks, confirmed loss, restored access and insufficient evidence.

The existing client calls GitHub's [repository-permission endpoint](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user) with an installation token. Its documented roles include `none`, and current read-only API observation confirmed a successful `none` response with an immutable user ID. This is response-shape evidence, not a deployed GitHub App removal test. GitHub also permits a null user or a 404. A bare 404 cannot distinguish creator loss from repository or App invisibility; null or mismatched identities cannot prove whose access changed. Hub denies those repository requests without revoking links. Transport failures, rate limits, incomplete or unknown responses also never count as confirmed loss.

This is a **suspension compensating-control proposal**, not automatic GitHub.com account-suspension detection or blanket browser/canvas revocation. Security acceptance in [#166](https://github.com/github/replica/issues/166) remains pending. Hub stores no persistent GitHub user token and adds no SCIM or account polling.

## Overlapping requests

Policy changes, creator-loss revisions, creation and handoff consumption serialize through the primary SQLite write transaction. Creation captures the policy revision before repository authorization and the creator revision before the external GitHub lookup. It checks both inside the creation transaction, so a preceding disable/re-enable or confirmed-loss/regained-access cycle cannot authorize an earlier in-flight request.

Public responses check current policy and the live link again after page rendering or artifact preparation. Artifact streaming checks access before each existing 64 KB chunk, then releases the primary database lock before sending it. A slow client cannot hold that lock while the administrator disables sharing. An already-checked chunk may finish after disable or creator revocation; the next chunk must pass a new check. Subsequent requests, including those with an old cookie, also recheck access.

An already-delivered page, file or chunk cannot be recalled, and bytes already buffered by the server or client may arrive later. Already-loaded JavaScript is not remotely erased. Artifact reads and GitHub calls stay outside the policy transaction; these checks do not change preview origins, framing, sandbox or header policy.

## Access

A share link is public while deployment sharing is enabled and the link remains active. Anyone with its URL can open it without GitHub sign-in. Hub does not send the visitor's identity, repository details, screenshots, or review conversations to the shared preview.

This includes a suspended account or someone who has left the organisation. Until expiry or revocation, possessing the URL is enough; Hub does not authenticate the public visitor. The creator-access check can stop links after observed repository-access loss, but it does not remove this residual risk or guarantee immediate offboarding. Security acceptance remains pending.

Both the Hub and canvas creation pages warn that anyone with the URL can view the Build and that prototype content may expose sensitive or customer information. Authors must check the Build's content before creating a public link. The absence of private review data does not make the prototype itself safe to publish.

Each link points to one Build. A newer Build does not change an existing link.

A signed-in user may manage a Prototype's share links when either rule applies:

- GitHub reports that the user is a repository administrator.
- A successful Build for the Prototype records the user as its commit author, and GitHub still reports at least read access.

The management page opens within the prototype workspace beneath the branch header. Its Build selection stays tied to the requested successful Build; returning to the preview keeps the same workspace navigation.

## Canvas API

The browser and canvas controllers share link permissions and creation through `HasShareLinkContext`. Browser creation keeps its redirect to the management page. The canvas endpoint uses a repository-scoped bearer token and checks current GitHub access before creating a link.

`POST /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/share_links` accepts:

```json
{
  "share_link": {
    "build_number": 1,
    "label": "Usability review",
    "expiration": "seven_days"
  }
}
```

By default, `expiration` accepts `one_day` or `seven_days`. A [maximum lifetime](#link-lifetime) of thirty days also permits `thirty_days`; a one-day maximum permits only `one_day`. Omitting the choice uses seven days, or one day when that is the maximum. Success returns HTTP 201 with `id`, the absolute public `url`, `buildNumber`, `label`, and an ISO 8601 `expiresAt` timestamp. The URL uses the configured Hub origin, not the request host. Invalid labels and disallowed expiration choices return HTTP 422 with an `errors` array.

`never` is rejected under every supported maximum, before any fresh-authorization challenge. Links created by older versions without an expiry receive a saved deadline at startup. Creating permitted expiring links retains the existing repository and Build-author permission rules.

The selected Build must be successful and belong to the authorized Prototype. The same administrator-or-Build-author permission rules apply; repository write access alone does not authorize sharing. Every successful request creates a new link.

`GET` on the same collection returns `{shareLinks, hasMore, nextCursor}`. Each link includes the creation response's fields plus `createdAt` and `createdBy: {login, name}`. The list includes all active links for the Prototype across Builds, newest first. Pages contain at most 25 links; pass the signed `nextCursor` as `cursor` to read the next page. An invalid cursor returns HTTP 400 with `errors`. Expired and deleted links are omitted.

`DELETE /api/canvas/repositories/:repository_github_id/prototypes/:prototype_id/share_links/:id` removes a link under the authorized Prototype and returns HTTP 204. A missing link returns HTTP 404 with an instruction to refresh the active list. Deletion immediately removes public access. Listing and deletion use the same sharing permissions as creation. Mutations check current GitHub permission; display-only reads follow the canvas's short permission cache. Responses are private and not cached.

Prototype metadata includes `canManageShareLinks`, computed from the same permission rule, and `shareLinkExpirationOptions`, the expiration values allowed by this deployment. Clients must not substitute `canEdit` or the latest Build's author for this flag. The browser and updated canvas offer only the allowed expiration values; Hub also rejects disallowed API requests from older clients.

## Canvas management

The canvas pairs its existing Publish button with a share-icon button on the right. **Share prototype** opens the full-page view when Hub confirms repository access and a successful published Build. **Internal prototype link** shows that Build's normal Hub URL with copy and open actions. It requires GitHub sign-in and repository access; it does not grant public access. Repository readers can use it without permission to manage public links. A missing or invalid Hub URL is shown as unavailable, never replaced with a local preview address.

**Public share links** keeps the existing sharing permissions and Build-pinned creation flow. Readers without confirmed public-sharing permission see an explanation instead of the creation form or active public links. The canvas does not request the public-link list for them. The control-settings checkbox applies to both internal and public links, including when public sharing is unavailable. The Hub website's sharing interface is unchanged.

Disabling deployment-wide public sharing hides public URLs and creation controls, but keeps the captured internal prototype link available to repository readers. Re-enabling public sharing still requires a fresh context read and does not restore revoked links.

Both internal and public URLs have an icon-only Open control directly after the copyable URL field, using the same external-link icon. Accessible labels and hover or focus tooltips identify which link opens.

The canvas uses compact section headings with muted subtitles and a divider between internal and public sharing. Read-only URL fields have a muted background. The new-link target's Build number, commit, and publication time appear inline instead of under a separate Build heading. Storybook's **Two builds** example shows one active link for Build 1 and one for Build 2.

Created-link Build labels are bold. The **Two builds** Storybook example also previews hover and keyboard-focus details with fixture commits, authors, and publication times. This is a presentation experiment, not live Build metadata: production links do not offer these details, and the share-link API is unchanged.

Links to Builds older than the page's captured new-link target use muted titles. Current and newer Build links retain their normal title color; Copy, Open, and Delete are unchanged.

Without a successful published Build or verified connection, a small dialog keeps the preview visible and explains the next step: **Connect to Hub**, the existing **Publish** or **Publish changes** action, or publication progress and recovery. Verification failures offer **Retry status**, never an inferred Publish action. Restricted permissions and local or excluded branches explain why sharing is unavailable.

After the user starts connection or publication, the dialog updates to **Share prototype** when ready. It never publishes, creates a link, or navigates automatically. Closing it does not cancel an already-dispatched publication. Reopening reads the current status; repository, branch, or Hub changes require closing and reopening rather than silently changing the dialog's target. Successful publication updates the toolbar to a **Published** status without opening a dialog or page. Hovering or focusing it shows **Latest changes already published**; it does not dispatch publication. The Share button is the only entry point for sharing.

The management view can create links, list active links across the Prototype's Builds, copy or open them, and delete them after confirmation. **Back to preview** restores the existing preview and returns focus to the Share button; it does not reload the prototype. An older successful published Build remains shareable even with newer local changes or a pending or failed publication. Sharing uses Hub's `canManageShareLinks`, not repository write access or an exact checkout commit match. A read-only Build author may share; a read-only unpublished viewer cannot publish. Repository connection metadata supplies `canPublish` before Hub discovers a prototype. On older Hubs that omit it, a repository-authorized connection and a verified missing remote branch offer the existing **Publish** action with an explicit permission-verification note. A missing remote branch is a publishing prerequisite, not a permission denial. The same dialog follows an explicitly requested publication as the remote branch appears. Copilot verifies the target and access during publishing and reports permission errors; the canvas does not assume permission or bypass Hub authorization. Explicit denials, mismatched or unverifiable targets, and unknown sharing permission still block the relevant action.

New links target the latest successful published Build displayed when the management page opens. The Build stays fixed until the user leaves that view, even if a newer Build arrives. The canvas has no historical Build picker; existing links to older Builds still appear in the list. Opening the page does not publish or create a link. Public sharing never exposes the canvas's local address or uncommitted checkout.

If the user reopens while a request is pending, the canvas waits for it to settle, then captures the latest published Build and reads all active links. New mutations remain disabled until both reads finish. Closing again cancels that queued reopening, not the dispatched request.

Hub and the canvas use the same `ShareLinksContent`, `ShareLinksForm`, and `ShareLinkRow` components, plus the shared Prototype workspace header layout and content body. They share the subtle canvas background, content width and padding, form grid, and list and empty-state presentation. Labels appear above their controls, with a required indicator on the label field and no helper text. Desktop labels, controls, and validation occupy separate shared grid tracks; narrow layouts stack the fields.

Hub supplies native Rails form actions, CSRF tokens, browser links, repository navigation, and a historical Build picker. The canvas supplies controlled form values and Node API callbacks, a fixed Build indicator, and **Back to preview** instead of Hub navigation. Shared presentation does not share authentication or replace either transport.

Creation requires a label and an explicit **Create share link** click. Copying and opening are separate actions. The extension keeps Hub bearer credentials in Node and validates public URLs before asking the host to open a browser.

Loading, unavailable connections, insufficient permission, and missing published Builds have separate explanations. A failed list is not an empty list. When a mutation's response is lost, the canvas says that it may have completed and requires a fresh list before another attempt; it does not automatically repeat creation. Identical labels do not prove which request created a link.

After successful creation, a failed list read preserves the new URL in a recovery field only if its row is missing. Normal refreshes do not duplicate the URL. A complete active list removes any remembered created URL that is no longer present, so a later failure cannot restore an inactive link.

The canvas automatically reads every API page and shows all active links, without a Load more button. It replaces the displayed list only after every page succeeds; a failed page leaves the previous list visible with an error and disables mutations until recovery. Reopening the management page, window focus, and a 30-second refresh read Hub again. **Refresh links** requests the same full list immediately, including changes made in the browser; it does not publish or create links. Background reads do not extend connection activity. Public URLs remain in panel memory, not saved canvas state or prototype content. Returning to the preview does not cancel an already-dispatched mutation.

## Control settings

**Include control settings** sits below the page heading and above both sharing sections in the canvas. It applies to internal and public sharing. Hub keeps it directly below the public-link creation fields. It defaults off and remembers the choice separately for each prototype. Hub saves the preference in the current browser; the canvas saves it in the local Copilot profile, keyed by Hub, repository and prototype, so it survives new panels and extension restarts. Only that checkbox preference is saved under `$COPILOT_HOME/extensions/replica-prototype/artifacts/share-control-settings/` (`~/.copilot` by default), not public links or control values. Checking it adds the current non-default settings from all configured pages to copied and opened URLs. Unchecking it removes those parameters. It does not change the stored link, pinned Build, permissions, expiration or page destination.

In Hub, the settings come from the preview URL and follow navigation to share management and its create/delete redirects. In the canvas, they come from local control state, including saved settings from other pages; the local preview URL remains unchanged.

Saving the canvas preference does not require public-sharing permission or a successful public-link refresh. It still requires the captured Hub and checkout to match. Public-link actions retain their permission, policy and list-freshness checks.

The canvas shows a yellow warning only when the option is checked and Git reports working-tree changes or a known local commit differs from the published Build: **Settings for controls that have not been published will not take effect for shared links.** A pushed commit can still differ while publication is pending. Unknown status alone does not show the banner.

Parameters use `rc.<scope>.<controlId>`, with JSON-encoded values. A bare link opens with declared defaults, not that visitor's previously saved settings. Parameters may also be appended manually, for example `?rc.page.enabled=false&rc.page.layout=grid`; use JSON quotes when text would otherwise parse as a boolean or number. Each page applies only the scopes it mounts. Shared layouts can intentionally reuse the same scope across pages.

Settings are visible in the URL: do not use controls to share credentials or private information. Invalid or duplicate parameters fall back to defaults with a notice. Controls removed or changed in an older Build are checked against its declarations when their page mounts. The encoded settings have an 8 KB limit; an oversized configured share shows an error rather than offering a truncated or plain link as success. Preference-storage failures are also visible.

Storybook's **Components / Prototype canvas / Share links page / Control settings** stories retain checked, unchecked, matching-Build, changed-Build and unknown-status examples.

## Link lifetime

Public share links have a seven-day maximum by default, including when `REPLICA_SHARE_LINK_MAX_DAYS` is unset. Authors can choose one day or seven days; new never-expiring links are not permitted.

Operators can set `REPLICA_SHARE_LINK_MAX_DAYS` to `1`, `7`, or `30`. A one-day maximum permits only one-day links. A thirty-day maximum also permits thirty-day links, while new links still default to seven days. Invalid values, including an empty value, prevent startup instead of removing the restriction. See [Enable a maximum share-link lifetime](deployment.md#enable-a-maximum-share-link-lifetime) for deployment steps.

Before serving requests, each application startup automatically and permanently shortens missing or longer saved expiry dates to original creation time plus the maximum. It retains earlier deadlines and revoked records. The update is transactional and safe to repeat; no separate operator backfill is required. A database update failure prevents startup rather than silently skip a link. A link created six days ago has at most one day left under the seven-day maximum. **Existing links at least seven days old expire immediately on upgrade or activation of the seven-day maximum**, including links previously set to thirty days or no expiration.

Hub rejects requests at the exact expiry time. Share pages, preview authorization and every preview-file request check the current link, including requests with old cookies. Streams check again between chunks; see [Overlapping requests](#overlapping-requests) for what can finish after a check. Link lists and browser/canvas expiry labels use the same date. Daily cleanup removes expired links, but access stops without waiting for cleanup.

Startup also shortens links nobody visits. Choosing a shorter maximum shortens existing deadlines at the next restart; choosing a longer maximum never extends saved deadlines or restores expired URLs. Removing the setting returns to the seven-day maximum, which can shorten thirty-day deadlines but cannot extend one-day deadlines. Only newly created links can use longer choices. See [Change the maximum](deployment.md#change-the-maximum) for examples and restart requirements. Deleting a link, disabling sharing and confirmed creator-access loss still stop those links permanently. The setting does not enable public sharing.

The maximum limits how long a public URL can work. It does not detect GitHub account suspension or organization departure, automatically offboard a person, or end browser Sessions or canvas connections. Do not wait for expiration when immediate containment is required; follow the [offboarding procedure](deployment.md#offboard-a-person-or-contain-a-reported-suspension). Security acceptance for [#166](https://github.com/github/replica/issues/166) remains pending.

Hub shows only active, unrevoked links while sharing is enabled. Deleting a link immediately removes access. An expired, revoked or deleted URL returns not found.

If the GitHub App no longer includes the repository, its share links return not found without calling GitHub. Reinstalling restores only unrevoked, unexpired links while deployment sharing is enabled; it never reverses a deployment or creator-access revocation.

## Preview flow

```text
visitor opens /share/<random ID>
        |
        v
Hub checks the link and local repository state
        |
        v
Hub opens the exact Build on an isolated share-preview host
        |
        v
the preview serves retained dist files without review features
```

The public URL uses a random UUID. Hub stores it so an authorized user can copy the active link again.

The share page runs on the Hub origin, but the Build files do not. Prototype JavaScript remains on a separate preview origin and never receives Hub cookies.

The prototype fills the viewport. Compatible Builds keep a floating Controls toggle over the preview.

Visitors can use [prototype controls](preview-serving.md#prototype-controls) when the shared Build has a compatible runtime. Edits update their URL without changing the Build, other visitors or private reviews.
