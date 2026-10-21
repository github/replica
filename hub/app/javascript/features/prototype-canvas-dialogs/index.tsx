import { BuildDetailsDialog } from "@components/prototype-build-details-dialog"
import { HubConnectionDialog } from "@components/prototype-hub-connection-dialog"
import { PublishChangesDialog } from "@components/prototype-publish-changes-dialog"
import { ShareLinksPage } from "../prototype-canvas-share-links"
import { readinessCopy } from "@utils/resolve-prototype-share-readiness/en"
import { ShareReadinessDialog } from "@components/prototype-share-readiness-dialog"
import type { Props } from "./types"
import { publishChangesCopy } from "@hooks/use-canvas-publish-preference/en"

/** Presents mutually coordinated dialogs without replacing the underlying preview. */
export function AppDialogs({
  hub,
  connection,
  publication,
  sharing,
  shareIntent,
  controlSettings,
  readiness,
  state,
  hubOpen,
  buildDetailsOpen,
  onCloseBuildDetails,
  shareButtonRef,
  hubButtonRef,
  connectionButtonRef,
  publishButtonRef,
  titleButtonRef,
}: Props) {
  const { intent, targetChanged } = shareIntent
  const presentedState = publication.presentedState

  return (
    <>
      {connection.open && (!intent || (intent.connecting && !targetChanged)) ? (
        <HubConnectionDialog
          status={hub.status}
          pairing={connection.pairing}
          connecting={connection.connecting}
          error={connection.error}
          onConnect={connection.connect}
          onSelectHub={hub.select}
          onResetHub={hub.reset}
          onClose={() => {
            connection.close()
            shareIntent.setConnecting(false)
          }}
          hubButtonRef={intent ? shareButtonRef : hubOpen ? connectionButtonRef : hubButtonRef}
        />
      ) : null}
      {intent &&
      !publication.publishDialog &&
      (targetChanged || !intent.connecting || !connection.open) ? (
        <ShareReadinessDialog
          readiness={
            targetChanged
              ? {
                  kind: "restricted",
                  title: readinessCopy.changed,
                  detail: readinessCopy.changedDetail,
                }
              : readiness
          }
          busy={publication.busy}
          shareButtonRef={shareButtonRef}
          onClose={() => {
            shareIntent.close()
            connection.close()
          }}
          onConnect={() => {
            if (targetChanged || readiness.kind !== "connect") return

            shareIntent.setConnecting(true)
            connection.showAndConnect()
          }}
          onPublish={() => {
            if (!targetChanged && readiness.kind === "publish") void publication.publish()
          }}
          onRetry={() => void publication.retry()}
          onManage={() => {
            if (targetChanged || readiness.kind !== "ready") return

            shareIntent.close()
            void sharing.open()
          }}
        />
      ) : null}
      {publication.publishDialog ? (
        <PublishChangesDialog
          key={
            publication.publishDialog.preparation.workingTree === "unavailable"
              ? "unchecked"
              : "checked"
          }
          busy={publication.busy}
          error={publication.publishDialogError}
          changes={publication.publishDialog.preparation.changes}
          checkError={
            publication.publishDialog.preparation.workingTree === "unavailable"
              ? publication.publishDialog.preparation.workingTreeError ||
                publishChangesCopy.checkFailed
              : undefined
          }
          remembered={publication.publishDialog.preparation.remember}
          returnFocusRef={intent ? shareButtonRef : publishButtonRef}
          onClose={publication.closePublishDialog}
          onChoose={(mode, remember) => void publication.choosePublish(mode, remember)}
          onRetry={() => void publication.retryPublishCheck()}
        />
      ) : null}
      {sharing.state.open ? (
        <ShareLinksPage
          state={sharing.state}
          currentCommit={state?.stats.commitSha}
          hasLocalChanges={state?.stats.workingTree === "changed"}
          shareButtonRef={shareButtonRef}
          onClose={sharing.close}
          onConnect={
            !hub.status || ["disconnected", "pairing", "unconfigured"].includes(hub.status.state)
              ? () => {
                  sharing.close()
                  connection.show()
                }
              : undefined
          }
          onRefresh={() => void sharing.refresh()}
          onCreate={sharing.create}
          onDelete={sharing.remove}
          onOpen={(id, query) => void sharing.openLink(id, query)}
          controlSettings={controlSettings}
          onAuthorize={() => void sharing.authorize()}
        />
      ) : null}
      {buildDetailsOpen && presentedState ? (
        <BuildDetailsDialog
          state={presentedState}
          titleButtonRef={titleButtonRef}
          onClose={onCloseBuildDetails}
        />
      ) : null}
    </>
  )
}
