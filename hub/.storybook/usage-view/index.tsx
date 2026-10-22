import React from "react"

import type { UsageViewProps } from "./types"

export function UsageView({ entries, storyLinks }: UsageViewProps) {
  function sourceLink(path: string, line?: number) {
    return `https://github.com/github/replica/blob/main/hub/${path}${line ? `#L${line}` : ""}`
  }

  function relatedStories(path: string) {
    const links = storyLinks[path] ?? []
    return links.length > 0 ? (
      <span>
        {" - "}
        {links.map((story, index) => (
          <span key={story.id}>
            {index > 0 ? ", " : ""}
            <a href={`./?path=/story/${story.id}`} target="_parent">
              {story.title}
            </a>
          </span>
        ))}
      </span>
    ) : null
  }

  return (
    <div
      style={{
        padding: "1rem 1.5rem",
        fontSize: "0.8125rem",
        lineHeight: 1.6,
        overflowWrap: "anywhere",
      }}
    >
      <p>
        Counts are JSX source locations, not runtime instances. Tests, stories and fixtures are
        excluded. Source links open the default branch on GitHub; local edits may differ.
      </p>
      {entries.length === 0 ? (
        <p>
          No application component is declared in this story&apos;s default metadata. Usage is
          unavailable for this story.
        </p>
      ) : (
        entries.map(({ path, usage }) => {
          const count = usage.consumers.reduce((sum, consumer) => sum + consumer.lines.length, 0)
          return (
            <section key={path} aria-label={`Usage of ${path}`}>
              <h2 style={{ fontSize: "1rem" }}>
                <a href={sourceLink(path)} target="_blank" rel="noreferrer">
                  {path}
                </a>
              </h2>
              <h3 style={{ fontSize: "0.875rem" }}>
                Direct consumers: {count} JSX locations in {usage.consumers.length} files
              </h3>
              {usage.consumers.length === 0 ? (
                <p>No production consumers found.</p>
              ) : (
                <ul>
                  {usage.consumers.map((consumer) => (
                    <li key={consumer.path}>
                      <a
                        href={sourceLink(consumer.path, consumer.lines[0])}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {consumer.path}
                      </a>
                      {" - "}
                      {consumer.lines.length}{" "}
                      {consumer.lines.length === 1 ? "location" : "locations"}; lines{" "}
                      {Array.from(new Set(consumer.lines)).join(", ")}
                      {relatedStories(consumer.path)}
                    </li>
                  ))}
                </ul>
              )}
              <h3 style={{ fontSize: "0.875rem" }}>
                Transitive pages and surfaces: {usage.surfaces.length}
              </h3>
              {usage.surfaces.length === 0 ? (
                <p>No page or application surface found through JSX consumers.</p>
              ) : (
                <ul>
                  {usage.surfaces.map((surface) => (
                    <li key={surface}>
                      <a href={sourceLink(surface)} target="_blank" rel="noreferrer">
                        {surface}
                      </a>
                      {relatedStories(surface)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
      <details>
        <summary>Static analysis limits</summary>
        <p>
          Follows local JSX tags through resolved TypeScript symbols, including import aliases and
          re-exports. Traversal is file-level, not proof that a page renders a component. Multiple
          exports in one file share usage. Dynamic component props, registries, createElement calls,
          non-JSX templates and external packages are not traced. Components used only within their
          own file are not counted. Story-only helpers outside excluded directories can appear as
          consumers.
        </p>
      </details>
    </div>
  )
}
