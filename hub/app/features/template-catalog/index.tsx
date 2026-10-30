import { SearchIcon } from "@primer/octicons-react"
import { useState } from "react"

import { HubEmptyState } from "@components/hub-empty-state"
import { TemplateCard } from "@components/template-card"
import { PrototypeIndexHeader } from "@features/prototype-index-header"

import type { TemplateCatalogData } from "./types"
import "./styles.css"

/** Filters the retained default-branch templates without changing the creation brief. */
export function TemplateCatalog({
  data,
  searchShortcutEnabled = true,
}: {
  data: TemplateCatalogData
  searchShortcutEnabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const search = query.trim().toLowerCase()
  const templates = data.templates.filter((template) =>
    `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(search),
  )

  return (
    <section className="template-catalog" aria-label={data.heading}>
      <PrototypeIndexHeader
        heading={data.heading}
        headingAs="h2"
        searchLabel={data.searchLabel}
        clearSearchLabel={data.clearSearchLabel}
        searchQuery={query}
        searchShortcutEnabled={searchShortcutEnabled}
        onSearchChange={setQuery}
        tools={
          <span className="template-catalog__count" aria-live="polite">
            {templates.length} {templates.length === 1 ? data.countUnitOne : data.countUnitOther}
          </span>
        }
      />

      {data.noAdditionalTemplatesLabel && !search ? (
        <p className="template-catalog__empty">{data.noAdditionalTemplatesLabel}</p>
      ) : null}

      {templates.length ? (
        <div className="template-catalog__grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              openLabel={data.openTemplateLabel}
              unavailableLabel={data.previewUnavailableLabel}
            />
          ))}
        </div>
      ) : (
        <HubEmptyState
          visual={<SearchIcon size={24} />}
          heading={data.noSearchResultsHeading}
          description={data.noSearchResultsDescription}
          actionLabel={data.clearSearchLabel}
          onAction={() => setQuery("")}
        />
      )}
    </section>
  )
}
