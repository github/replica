import { useState } from "react"
import {
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router"

import type { PrototypeViewMode } from "@components/prototype-view-mode-control/types"
import { RepositoriesShowPage } from "@pages/repositories-show-page"
import type { PrototypeAuthorResults } from "@utils/prototype-listing/types"

import type { RepositoryResponse, WorkspaceResponse } from "../../contracts"
import { repositoryShowData } from "../../view-models/repository-show"

export function RepositoryScreen({
  workspace,
  data,
  loadAuthors,
}: {
  workspace: WorkspaceResponse
  data: RepositoryResponse
  loadAuthors: (
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<PrototypeAuthorResults>
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const [search, setSearch] = useSearchParams()
  const [draft, setDraft] = useState({ location, value: search.get("q") ?? "" })
  const query = draft.location === location ? draft.value : (search.get("q") ?? "")
  const view: PrototypeViewMode = search.get("view") === "list" ? "list" : "gallery"

  function changeFilter(key: "q" | "author" | "view", value: string) {
    const next = new URLSearchParams(search)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== "view") next.delete("page")
    setSearch(next)
  }

  return (
    <RepositoriesShowPage
      key={data.repository.id}
      data={repositoryShowData(workspace, data, search)}
      view={view}
      onViewChange={(value) => changeFilter("view", value === "gallery" ? "" : value)}
      controls={{
        query,
        pending: navigation.state !== "idle" || revalidator.state !== "idle",
        error: false,
        onQueryChange: (value) => {
          setDraft({ location, value })
          if (!value) changeFilter("q", "")
        },
        onQuerySubmit: () => changeFilter("q", query.trim()),
        onAuthorChange: (value) => changeFilter("author", value),
        onNavigate: (path) => {
          void navigate(path)
        },
        onRetry: () => {
          void revalidator.revalidate()
        },
        loadAuthors,
      }}
    />
  )
}
