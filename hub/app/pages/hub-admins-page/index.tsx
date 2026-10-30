import { useRef, useState } from "react"

import { Button, Heading, Text } from "@primer/react-brand"

import { AddHubAdministrators } from "@features/add-hub-administrators"
import type { HubAdministratorSearchResults } from "@features/add-hub-administrators/types"
import { HubAdministrationPage } from "@features/hub-administration-page"

import type { HubAdminsPageData } from "./types"
import "./styles.css"

/** Lists administrators and confirms additions from existing Hub users. */
export function HubAdminsPage({
  data,
  onSearch,
}: {
  data: HubAdminsPageData
  onSearch: (query: string) => Promise<HubAdministratorSearchResults>
}) {
  const [adding, setAdding] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <HubAdministrationPage data={data}>
      {data.addAdministrator ? (
        <div className="hub-admins-page__list-header">
          <Heading as="h2" size="6">
            {data.administratorsLabel}
          </Heading>
          <Button ref={trigger} type="button" variant="primary" onClick={() => setAdding(true)}>
            {data.addLabel}
          </Button>
        </div>
      ) : null}

      {data.users.length ? (
        <ul className="hub-admins-page__users">
          {data.users.map((user) => (
            <li key={user.id} className="hub-admins-page__user">
              <div>
                <strong>{user.name ?? user.login}</strong>
                <Text as="p">@{user.login}</Text>
                <Text as="p" size="100">
                  {user.identity}
                </Text>
                <Text as="p">{user.role}</Text>
              </div>

              <Button as="a" href={user.confirmationPath} variant="secondary">
                {user.actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Text as="p">{data.emptyLabel}</Text>
      )}

      {data.nextPath ? (
        <Button as="a" href={data.nextPath} variant="secondary">
          {data.nextLabel}
        </Button>
      ) : null}

      {adding && data.addAdministrator ? (
        <AddHubAdministrators
          data={data.addAdministrator}
          authenticityToken={data.authenticityToken}
          onSearch={onSearch}
          onClose={() => {
            setAdding(false)
            trigger.current?.focus()
          }}
        />
      ) : null}
    </HubAdministrationPage>
  )
}
