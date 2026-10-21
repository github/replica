# Modular Page Layouts Guide

Use these components to compose page headers, padded content, collections, tabs, and responsive panels. Layout components own spacing and scrolling; callers own application data, actions, and persistent state.

Route screens should compose these page components instead of creating their own page frames, headers, or sidebar drawers. Keep domain-specific content with its owning routes; the application shell should contain shared navigation and chrome.

## Quick Start

Import layouts from `~/components/common` and design-system controls from `@coreai-ds/react-components`. A basic page needs a frame, a header, and a body:

```tsx
import { PageBody, PageHeader, PageLayout } from '~/components/common';

export function ProjectPage() {
  return (
    <PageLayout header={<PageHeader title="Project" />}>
      <PageBody>Project content</PageBody>
    </PageLayout>
  );
}
```

By default, the header stays in place while the content region scrolls. `PageBody` supplies the content padding. Use the existing app shell, or another host with a bounded height, for this behavior.

## Choose a Composition

| Need                                      | Use                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Plain page or full-page form              | `PageLayout` + `PageHeader` + `PageBody`; add `footer` for persistent actions |
| Standalone collection                     | `CollectionPage`, or `CollectionDetailsPage` for row-driven details           |
| Collection inside an existing page or tab | `GridContent` or `GridDetailsContent`                                         |
| Left filters or configuration             | `SidebarLayout` inside a `PageLayout`                                         |
| Right details for custom content          | `DetailsLayout`                                                               |
| Route-driven page tabs                    | `TabbedPageLayout` with child routes                                          |
| Custom inline/overlay panel               | `ResponsivePanel`                                                             |

Start with the smallest composition that fits the screen. See the
[page layout migration](../../../../.github/docs/migrations/coreai/page-layout-migration.md)
for historical records and legacy component mappings.

## Architecture

```text
PageLayout                         frame, scroll ownership, optional footer
  PageHeader                       optional, supplied through header prop
  PageBody                         padded content OR padding="none"

SidebarLayout                      left inline panel / button-opened drawer
  ResponsivePanel position=start
  PageBody                         configurable content padding

DetailsLayout                      main content + right details
  PageBody                         configurable content padding
  ResponsivePanel position=end

GridContent                        PageBody + DataGridWithFilters
GridDetailsContent                 DetailsLayout + grid selection behavior

CollectionPage                     PageLayout + PageHeader + GridContent
CollectionDetailsPage              PageLayout + PageHeader + GridDetailsContent
TabbedPageLayout                   PageLayout + PageHeader/TabLinkList + Outlet
```

These are compositions, not an inheritance hierarchy. There is no universal component with flags for every screen type, and no separate family of duplicated tab-subpage wrappers.

## Source Reference

| File                                                   | Responsibility                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| [PageLayout.tsx](PageLayout.tsx)                       | Page frame, scroll ownership, and optional footer              |
| [PageBody.tsx](PageBody.tsx)                           | Explicit body padding and optional scrolling                   |
| [PageLayout.module.css](PageLayout.module.css)         | Explicit body padding, frame constraints, scroll modes, footer |
| [PageHeader.tsx](PageHeader.tsx)                       | Title and named content slots                                  |
| [PageBackLink.tsx](PageBackLink.tsx)                   | Internal router-aware header back link                         |
| [PageHeader.module.css](PageHeader.module.css)         | Header alignment and narrow-title wrapping                     |
| [ResponsivePanel.tsx](ResponsivePanel.tsx)             | Controlled inline/overlay panel presentation                   |
| [SidebarLayout.tsx](SidebarLayout.tsx)                 | Left sidebar and mobile trigger                                |
| [DetailsLayout.tsx](DetailsLayout.tsx)                 | Right details layout and `PanelDetails`                        |
| [PanelLayouts.module.css](PanelLayouts.module.css)     | Split regions, panel dimensions, portal-safe spacing           |
| [GridContent.tsx](GridContent.tsx)                     | Padded, scrollable grid content                                |
| [GridDetailsContent.tsx](GridDetailsContent.tsx)       | Grid selection, details, and focus restoration                 |
| [CollectionPage.tsx](CollectionPage.tsx)               | Standalone collection header and grid                          |
| [CollectionDetailsPage.tsx](CollectionDetailsPage.tsx) | Standalone collection with row-driven details                  |
| [TabbedPageLayout.tsx](TabbedPageLayout.tsx)           | Route-driven tabs and outlet context                           |
| [../index.ts](../index.ts)                             | Public modular layout exports                                  |

## Spacing

1. `PageLayout` adds **no body padding**. It provides a bounded flex frame.
2. `PageHeader` owns its header inset and divider.
3. `PageBody` defaults to `padding="default"`: top `spacingL`, horizontal `spacingPagePadding`, bottom `spacingXXXL`.
4. `PageBody padding="none"` contributes no padding. Use it only when a child owns the inset or is intentionally edge-to-edge.
5. `SidebarLayout` and `DetailsLayout` each supply their own main `PageBody`. Their `contentPadding` defaults to `default`.
6. When nesting a details/grid layout inside a sidebar, set the sidebar's `contentPadding="none"`. The nested content owns the inset.
7. Drawer headers and default body insets use responsive `spacingPagePadding` horizontally. Headers have `spacingL` vertical padding; bodies have `spacingL` bottom padding and top padding only when no header renders. Set `SidebarLayout.sidebarPadding="none"` or `PanelDetails.padding="none"` for unpadded body content; header padding is independent.

There are no `data-pagecontent` / `data-subpagecontent` attributes or ancestor-padding overrides in the page system. When porting code from an older branch, replace its legacy wrappers rather than restoring those overrides.

### Drawer Portal Spacing

Use `--spacingPagePadding` for horizontal panel and accordion insets. Inline content inherits the app-container override; portaled drawers inherit the viewport-responsive root definition (24px above 768px, 16px at or below it). The root definition includes explicit fallbacks because Fluent spacing tokens are defined on providers, not necessarily on `:root`. Without those fallbacks the custom property computes to an invalid value before reaching the portal.

For full-width accordion dividers, disable the panel body inset and put responsive horizontal padding inside each section: the item owns the full-width border, while its header and expanded content own their insets. The drawer body still owns scrolling. `contentPadding` controls only the main content area, independently of panel padding.

## Scrolling

| `PageLayout.scrollMode` | Owner                                               | Recommended content                                         |
| ----------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `content` (default)     | Frame's content region; header/footer stay in place | `PageBody` without `scrollable`                             |
| `page`                  | Entire frame, including header/footer               | Long document content in `PageBody`                         |
| `panes`                 | Descendant regions; frame itself clips overflow     | Sidebar/details/workspace layouts, or `PageBody scrollable` |

`PageBody.scrollable` defaults to false. `SidebarLayout.scrollable` defaults to true and applies to its main body. Set it to false when the child is another pane layout or owns its own scrolling, such as the workspace example.

All shrinkable flex boundaries use `min-width: 0` and `min-height: 0`. A host must still supply a bounded height, as the existing app shell does. Do not place a pane layout in an unbounded document and expect independent scrolling to work.

## Headers

`PageHeader` accepts:

- `title`: string rendered as the page's single `h1`.
- `titleBadge`: caller-provided node. Use a Badge with `shape="rounded"` for title statuses such as Active or Draft. The caller supplies the shape explicitly; PageHeader does not override the Badge component's defaults. Use Tags for chosen values such as categories or filters, not lifecycle status indicators.
- `count`: a subtle numeric suffix, including zero; never inferred from grid data.
- `headerActions`: caller-provided actions or navigation links.
- `description`, `navigation`: optional regions below the title row, in that order.
- `backTo`, `backLabel`: optional React Router destination and accessible label (default `Back`). The header renders an icon-only CoreAI `LinkButton` beside the title. Router resolution respects relative destinations and the deployment basename; normal clicks use client-side navigation while modified clicks retain native link behavior. Omit `backTo` to hide the control.

Use the back control for destination navigation, not arbitrary actions. A cancel, dismiss, or confirmation action belongs in `headerActions` or the caller's flow controls. The header does not expose an action-only `onGoBack` callback.

At app-container widths of 480px or less, header actions move below the title group. Badges do not shrink into the title text.

Render any banner in `description`, with visibility managed by the caller.

## Responsive Panels

### Shared Presentation

`ResponsivePanel` takes `position="start" | "end"`, a required string `title`, `open`, `onOpenChange`, and `children`. Optional props include `headerActions`, `showInlineHeader`, `padding`, `returnFocusRef`, `id`, and `collapseAt`. `showInlineHeader` defaults to true here; overlay headers always render. When the inline header is hidden, the region uses `title` as its accessible label.

- Inline presentation uses a labelled complementary region.
- Overlay presentation uses a labelled modal dialog provided by CoreAI `Drawer`.
- Every rendered header has a close button labelled `Close ${title}`. Overlay Escape and backdrop dismissal reach the same close callback; inline panels do not dismiss on Escape.
- `returnFocusRef` restores focus to the opener. Supply it for direct usage with custom content.
- Without `width`, the standard inline width is 420px, capped at 40% of the containing layout. Overlay width is capped at the viewport and 400px. Supply `width` as a positive pixel number for a fixed width in either presentation and either position. Explicit inline widths do not use the 40% cap; they are bounded by the containing layout. Overlay widths are bounded by the viewport.
- `collapseAt` defaults to 768px and is evaluated using the existing app `ContainerQueryProvider`, not a viewport media query. Supply a nonnegative integer pixel threshold.

### Left Sidebar

`SidebarLayout` adds the always-visible desktop sidebar and the mobile trigger at a fixed **1024px** app-container threshold.

The sidebar requires `sidebarTitle` and `sidebar`; main content is `children`. Optional props are `sidebarWidth`, `sidebarPadding`, `triggerLabel`, `triggerIcon`, `contentPadding`, and `scrollable`. `sidebarWidth` forwards the fixed pixel width to the panel; the Discover catalog uses `sidebarWidth={240}` to leave more space for cards. `sidebarPadding` defaults to `"default"`; use `"none"` when sidebar content owns its insets. `triggerIcon` uses the documented Button icon-slot type.

Mobile open state is internal. Returning to desktop clears that mobile-open state, so a subsequent resize to mobile does not unexpectedly reopen a modal. The visible trigger carries its dialog relationship and expanded state.

For a trigger inside an existing toolbar, supply a render function as `children`: `{sidebarTrigger => <Workspace toolbarStart={sidebarTrigger} />}`. Place the supplied node exactly once. It is null in inline mode, and the layout omits its default trigger toolbar when a render function is supplied. The layout still owns open state, dialog attributes, and the trigger ref used for focus restoration. Ordinary React-node children retain the default toolbar.

The Discover [CatalogView](../../../routes/discover/catalog/CatalogView.tsx) is a card-catalog example: `PageLayout` with `scrollMode="page"`, `PageHeader`, and `SidebarLayout` with `scrollable={false}`, filters on the left, and results on the right. The header and both columns scroll together. The sidebar's `header` render function places search, sorting, and the mobile filter trigger in a full-width row below the page header and above both columns. Selected filters use dismissible interaction tags above the cards in the results column. With filters hidden, the controls remain above a `PageBody` without independent scrolling. The mobile overlay retains its own scrolling. Filter/search state remains in the catalog, above the responsive panel.

Supplying `triggerIcon` makes the trigger icon-only. `triggerLabel` remains its accessible name and hover title; without an icon it renders the text label. The playground places Configuration immediately before its Chat/YAML/Code tabs.

The inline sidebar always hides its header and has a transparent background. Overlay drawers retain their surface background, title, and close button. `sidebarTitle` supplies the accessible region name and default trigger label. Details-panel headers and backgrounds are unchanged.

### Right Details

`DetailsLayout.details` is either undefined (closed) or a `PanelDetails` object with `title`, `content`, and optional `headerActions`, `padding`, and `width`. For example, `details={{ title: 'Details', content, width: 320 }}` sets a fixed 320px panel. Collection `renderDetails` callbacks can return the same `width` option. `padding` defaults to `"default"`; return `padding: "none"` for edge-to-edge details, including from collection `renderDetails` callbacks. It takes `onClose` and an optional `returnFocusRef`. Details use the shared panel's 768px threshold.

The last defined details object is retained during closing animations so the outgoing panel does not become blank. This is not a persistence mechanism for form state.

### State Ownership

Drawer subtrees can unmount on close and when inline/overlay presentation changes. Keep values that must survive those transitions above the drawer and pass them as controlled props. The workspace and filter samples demonstrate this. Do not rely on uncontrolled inputs inside a drawer to preserve drafts.

The sidebar provides a fixed-width responsive layout, not drag-to-resize behavior or filtering logic. Keep screen-specific behavior in the caller; resizing can be layered in separately if a screen needs it.

## Collection APIs and Loading

`GridContent` and `GridDetailsContent` both receive a `dataGridProps` object. Their page counterparts add a `headerProps` object; the shape of grid configuration does not change depending on whether it is a page or tab content.

`GridDetailsContent` adds a sibling `renderDetails(itemId)` callback. It owns single selection and focus restoration, so its grid props omit `selectionMode`, `selectedItems`, and `onSelectionChange`. Use a stable `getRowId` whenever rows can reorder; index identity is only a fallback.

Removing the selected ID from the supplied `items` clears selection and closes details. Closing details returns focus to the selected row radio. This membership check concerns supplied items, not a second independent implementation of the grid's internal search/pagination.

Loading is explicit:

- Render a caller-side `Spinner` inside `PageBody` while loading; the body has no loading API.
- `dataGridProps.isLoading` is grid loading and is passed to the existing grid implementation.
- Collection wrappers have no ambiguous outer `isLoading` prop.

## Composition Recipes

These snippets assume the named content and data are supplied by the caller. Import the layouts from `~/components/common` and design-system controls from `@coreai-ds/react-components`.

### Plain Page

```tsx
<PageLayout header={<PageHeader title="Project" headerActions={actions} />}>
  <PageBody>{isLoading ? <Spinner label="Loading..." /> : content}</PageBody>
</PageLayout>
```

### Collection Page or Tab Content

```tsx
<CollectionDetailsPage
  headerProps={{ title: 'Agents', count: agents.length }}
  dataGridProps={{ items: agents, columns, getRowId: agent => agent.id }}
  renderDetails={renderDetails}
/>

<GridDetailsContent
  dataGridProps={{ items: agents, columns, getRowId: agent => agent.id }}
  renderDetails={renderDetails}
/>
```

The tab-content form has no extra header and needs no `BasicSubpage` wrapper.

### Sidebar with Nested Details

```tsx
<PageLayout header={<PageHeader title="Agent management" />} scrollMode="panes">
  <SidebarLayout sidebarTitle="Filters" sidebar={filters} contentPadding="none" scrollable={false}>
    <GridDetailsContent dataGridProps={dataGridProps} renderDetails={renderDetails} />
  </SidebarLayout>
</PageLayout>
```

### Workspace or Creation Flow

```tsx
<PageLayout header={<PageHeader title="Create agent" />} footer={submitActions} scrollMode="panes">
  <SidebarLayout
    sidebarTitle="Configuration"
    sidebar={configurationFields}
    contentPadding="none"
    scrollable={false}
  >
    {workspaceWithItsOwnScrollRegion}
  </SidebarLayout>
</PageLayout>
```

The caller owns submit validation, pending state, and persistence. A layout is not a form controller.
