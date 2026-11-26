import { Button, Heading, Text } from "@primer/react-brand/esm"

import { HubAlert } from "@components/hub-alert"
import { HubWorkspace } from "@features/hub-workspace"

import type { NotificationSettingsPageData } from "./types"
import "./styles.css"

export function NotificationSettingsPage({ data }: { data: NotificationSettingsPageData }) {
  return (
    <HubWorkspace data={data}>
      <main className="notification-settings-page">
        <header>
          <Heading as="h1" size="3">
            {data.heading}
          </Heading>
          <Text as="p">{data.description}</Text>
        </header>

        {data.alert ? <HubAlert title={data.alert} variant="warning" /> : null}
        {data.pausedMessage ? <HubAlert title={data.pausedMessage} variant="warning" /> : null}

        <section>
          <form action={data.submitPath} method="post">
            <input type="hidden" name="_method" value="patch" />
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <input type="hidden" name="enabled" value="0" />
            <label className="notification-settings-page__checkbox">
              <input type="checkbox" name="enabled" value="1" defaultChecked={data.enabled} />
              <span>{data.enabledLabel}</span>
            </label>
            <Text as="p">{data.explanation}</Text>
            <Text as="p">{data.privacy}</Text>
            <Button type="submit">{data.saveLabel}</Button>
          </form>
        </section>

        <section aria-labelledby="muted-prototypes">
          <Heading as="h2" size="5" id="muted-prototypes">
            {data.mutedHeading}
          </Heading>
          <Text as="p">{data.prototypeExplanation}</Text>
          {data.mutes.length ? (
            <ul className="notification-settings-page__mutes">
              {data.mutes.map((mute) => (
                <li key={mute.id}>
                  <div>
                    <a href={mute.path} data-sg-visit="true">
                      {mute.prototype}
                    </a>
                    <Text as="p" size="100">
                      {mute.repository}
                    </Text>
                  </div>
                  <form action={mute.submitPath} method="post">
                    <input type="hidden" name="_method" value="patch" />
                    <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                    <input type="hidden" name="muted" value="0" />
                    <Button
                      type="submit"
                      variant="subtle"
                      aria-label={`${mute.unmuteLabel} ${mute.prototype}`}
                    >
                      {mute.unmuteLabel}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <Text as="p">{data.mutedEmpty}</Text>
          )}
        </section>

        {data.administration ? (
          <section aria-labelledby="notification-administration">
            <Heading as="h2" size="5" id="notification-administration">
              {data.administration.heading}
            </Heading>
            <Text as="p">{data.administration.description}</Text>
            <Text as="p">{data.administration.status}</Text>
            {data.administration.failureMessage ? (
              <HubAlert title={data.administration.failureMessage} variant="warning" />
            ) : null}
            <form action={data.administration.submitPath} method="post">
              <input type="hidden" name="_method" value="patch" />
              <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
              <input type="hidden" name="operation" value={data.administration.operation} />
              <label className="notification-settings-page__checkbox">
                <input type="checkbox" name="confirmed" value="1" required />
                <span>{data.administration.confirmLabel}</span>
              </label>
              <Button type="submit">{data.administration.submitLabel}</Button>
            </form>
          </section>
        ) : null}
      </main>
    </HubWorkspace>
  )
}
