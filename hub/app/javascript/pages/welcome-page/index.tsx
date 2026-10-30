import { useState } from "react"

import { BookIcon, LinkExternalIcon, PlusIcon, QuestionIcon } from "@primer/octicons-react"
import { Button, Heading, Text } from "@primer/react-brand/esm"

import { HubAlert } from "@components/hub-alert"
import { HubWorkspace } from "@features/hub-workspace"

import type { WelcomePageData } from "./types"
import "./styles.css"

export function WelcomePage({ data }: { data: WelcomePageData }) {
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null)
  const createPath = data.workspace.repository?.newPrototypePath

  return (
    <HubWorkspace data={data.workspace}>
      <div className="welcome-page-shell">
        <article className="welcome-page">
          <div className="welcome-page__content welcome-page__content--top">
            {data.notice ? <HubAlert title={data.notice} variant="success" /> : null}

            <header className="welcome-page__introduction">
              <Heading as="h1" size="2" className="welcome-page__heading">
                {data.heading}
              </Heading>
              <Text as="p" size="300" className="welcome-page__description">
                {data.description}
              </Text>
            </header>

            <section className="welcome-page__card welcome-page__media">
              {data.videoEmbedUrl ? (
                <iframe
                  key={data.videoEmbedUrl}
                  className="welcome-page__video-embed"
                  src={data.videoEmbedUrl}
                  aria-labelledby="welcome-video-heading"
                  allow="encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : data.videoUrl ? (
                <video
                  key={data.videoUrl}
                  className="welcome-page__video"
                  src={data.videoUrl}
                  poster={data.videoPosterUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={data.videoLabel}
                  onError={() => setFailedVideoUrl(data.videoUrl)}
                />
              ) : (
                <div className="welcome-page__video-placeholder">
                  <Text as="p" className="welcome-page__card-description">
                    {data.videoUnavailable}
                  </Text>
                </div>
              )}
              <div className="welcome-page__video-copy">
                <Heading
                  as="h2"
                  id="welcome-video-heading"
                  size="5"
                  className="welcome-page__card-heading"
                >
                  {data.videoLabel}
                </Heading>
                <Text as="p" className="welcome-page__card-description">
                  {data.videoDescription}
                </Text>
                {data.videoUrl && failedVideoUrl === data.videoUrl ? (
                  <HubAlert title={data.videoFailed} variant="warning" />
                ) : null}
              </div>
            </section>
          </div>

          <div className="welcome-page__dither-band">
            <div className="welcome-page__content welcome-page__content--bottom">
              <section className="welcome-page__cards">
                <a
                  className="welcome-page__card welcome-page__action"
                  href={data.readmePath}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={data.readmeLabel}
                >
                  <BookIcon size={16} aria-hidden="true" />
                  <div className="welcome-page__action-copy">
                    <Heading
                      as="h2"
                      size="5"
                      className="welcome-page__card-heading welcome-page__card-heading--external"
                    >
                      {data.readmeLabel}
                      <LinkExternalIcon size={12} aria-hidden="true" />
                    </Heading>
                    <Text as="p" className="welcome-page__card-description">
                      {data.readmeDescription}
                    </Text>
                  </div>
                </a>
                <a
                  className="welcome-page__card welcome-page__action"
                  href={data.setupPath}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={data.setupLabel}
                >
                  <QuestionIcon size={16} aria-hidden="true" />
                  <div className="welcome-page__action-copy">
                    <Heading
                      as="h2"
                      size="5"
                      className="welcome-page__card-heading welcome-page__card-heading--external"
                    >
                      {data.setupLabel}
                      <LinkExternalIcon size={12} aria-hidden="true" />
                    </Heading>
                    <Text as="p" className="welcome-page__card-description">
                      {data.setupDescription}
                    </Text>
                  </div>
                </a>
                {createPath ? (
                  <a
                    className="welcome-page__card welcome-page__action"
                    href={createPath}
                    data-sg-visit="true"
                    aria-label={data.createLabel}
                  >
                    <PlusIcon size={16} aria-hidden="true" />
                    <div className="welcome-page__action-copy">
                      <Heading as="h2" size="5" className="welcome-page__card-heading">
                        {data.createLabel}
                      </Heading>
                      <Text as="p" className="welcome-page__card-description">
                        {data.createDescription}
                      </Text>
                    </div>
                  </a>
                ) : (
                  <div className="welcome-page__card welcome-page__action">
                    <PlusIcon size={16} aria-hidden="true" />
                    <div className="welcome-page__action-copy">
                      <Heading as="h2" size="5" className="welcome-page__card-heading">
                        {data.createLabel}
                      </Heading>
                      <Text as="p" className="welcome-page__card-description">
                        {data.createUnavailable}
                      </Text>
                    </div>
                  </div>
                )}
              </section>

              {data.hidePath ? (
                <form action={data.hidePath} method="post" className="welcome-page__hide">
                  <input type="hidden" name="_method" value="patch" />
                  <input
                    type="hidden"
                    name="authenticity_token"
                    value={data.workspace.authenticityToken}
                  />
                  <Text
                    as="p"
                    id="welcome-hide-description"
                    className="welcome-page__hide-description"
                  >
                    {data.hideDescription}
                  </Text>
                  <Button
                    type="submit"
                    variant="subtle"
                    size="small"
                    aria-describedby="welcome-hide-description"
                  >
                    {data.hideLabel}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </article>
      </div>
    </HubWorkspace>
  )
}
