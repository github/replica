import { LinkExternalIcon } from "@primer/octicons-react"
import { Checkbox, FormControl, Heading } from "@primer/react-brand/esm"
import { useId } from "react"

import { CopyableTextInput } from "@components/copyable-text-input"
import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { PrototypeWorkspace } from "@features/prototype-workspace"
import { ShareLinkItem } from "@features/share-link-item"
import { ShareLinksForm } from "@features/share-links-form"
import { ShareLinksContent } from "@features/share-links-content"
import type { ShareLinksIndexPageData } from "./types"
import { ShareControlSettings } from "@features/prototype-canvas-share-links/share-control-settings"
import { withControlQuery } from "@utils/prototype-controls-url/with-control-query"
import { withViewMode } from "@utils/prototype-controls-url/with-view-mode"
import type { useShareControlSettings } from "@hooks/use-prototype-share-control-settings"
import { prototypeShareLink } from "@utils/prototype-share-link"
import type { useShareFullScreenPreview } from "@hooks/use-share-full-screen-preview"

/** Creates and lists the active public links for one Prototype. */
export function ShareLinksIndexPage({
  data,
  sourceControlQuery = "",
  controlSettings,
  previewPreference,
}: {
  data: ShareLinksIndexPageData
  sourceControlQuery?: string
  controlSettings?: ReturnType<typeof useShareControlSettings>
  previewPreference: ReturnType<typeof useShareFullScreenPreview>
}) {
  const fullScreenPreviewId = useId()
  const internalShareUrl =
    data.selectedBuild && !controlSettings?.blocked
      ? withViewMode(
          withControlQuery(
            prototypeShareLink(data.closePath ?? data.branchPath, "latest"),
            controlSettings?.query ?? "",
          ),
          previewPreference.fullScreenPreview,
        )
      : null

  return (
    <PrototypeWorkspace data={data}>
      <ShareLinksContent
        labels={data}
        feedback={
          <>
            {internalShareUrl && data.selectedBuild ? (
              <section className="share-links__internal">
                <Heading as="h2" size="5">
                  {data.internalHeading}
                </Heading>
                <p className="share-links__internal-description">{data.internalDescription}</p>
                <div className="share-link-item__actions">
                  <CopyableTextInput
                    value={internalShareUrl}
                    label={data.internalHeading}
                    copyLabel={data.internalCopyLabel}
                    copiedLabel={data.copiedLabel}
                    copyErrorLabel={data.copyErrorLabel}
                  />
                  <HubIconButton
                    as="a"
                    href={internalShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    icon={LinkExternalIcon}
                    aria-label={data.internalOpenLabel}
                    description={data.internalOpenLabel}
                  />
                </div>
                <FormControl id={fullScreenPreviewId}>
                  <Checkbox
                    checked={previewPreference.fullScreenPreview}
                    onChange={(event) => previewPreference.onChange(event.target.checked)}
                  />
                  <FormControl.Label>{data.fullScreenPreviewLabel}</FormControl.Label>
                </FormControl>
                {previewPreference.error ? <p role="alert">{previewPreference.error}</p> : null}
              </section>
            ) : data.selectedBuild ? (
              <p role="status">{data.internalUnavailableLabel}</p>
            ) : null}
            {data.alert ? (
              <HubAlert title={data.alert} variant="critical" layout="compact" />
            ) : null}
            {data.notice ? (
              <HubAlert title={data.notice} variant="success" layout="compact" />
            ) : null}
            {!data.publicSharingEnabled ? (
              <HubAlert title={data.disabledLabel} variant="warning" layout="compact" />
            ) : null}
          </>
        }
        form={
          data.publicSharingEnabled && data.selectedBuild ? (
            <ShareLinksForm
              data={data.form}
              action={data.form.createPath}
              hiddenFields={
                <>
                  <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                  <input type="hidden" name="control_query" value={sourceControlQuery} />
                  {data.managementBuildNumber ? (
                    <input
                      type="hidden"
                      name="management_build"
                      value={data.managementBuildNumber}
                    />
                  ) : null}
                  <input
                    type="hidden"
                    name="share_link[build_number]"
                    value={data.selectedBuild.number}
                  />
                </>
              }
              afterFields={
                controlSettings ? (
                  <ShareControlSettings
                    {...controlSettings}
                    publishedVersionDiffers={false}
                    copy={data.controlSettingsCopy}
                  />
                ) : null
              }
            />
          ) : null
        }
        formUnavailable={data.publicSharingEnabled ? undefined : null}
        showEmpty={data.publicSharingEnabled && !controlSettings?.blocked}
        hasLinks={
          data.publicSharingEnabled && !controlSettings?.blocked && data.shareLinks.length > 0
        }
        links={(data.publicSharingEnabled && !controlSettings?.blocked ? data.shareLinks : []).map(
          (shareLink) => (
            <ShareLinkItem
              key={shareLink.id}
              authenticityToken={data.authenticityToken}
              shareLink={{
                ...shareLink,
                url: withControlQuery(shareLink.url, controlSettings?.query ?? ""),
              }}
              controlQuery={sourceControlQuery}
              managementBuildNumber={data.managementBuildNumber}
              copiedLabel={data.copiedLabel}
              copyErrorLabel={data.copyErrorLabel}
              copyLabel={data.copyLabel}
              deleteLabel={data.deleteLabel}
              openLabel={data.openLabel}
            />
          ),
        )}
      />
    </PrototypeWorkspace>
  )
}
