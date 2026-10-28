# Storybook

## Purpose

Storybook is Replica Hub's primary workbench for designing and reviewing presentation code. Contributors can iterate on Components, Features, and Pages without running Rails, connecting GitHub, loading saved review data, or publishing a prototype.

## Run Storybook

Run Storybook inside the devcontainer:

```sh
bin/devcontainer storybook
```

Open <http://localhost:6006>. Build the static catalogue with:

```sh
bin/devcontainer exec npm run storybook:build
```

Rebuild the devcontainer once after pulling a change that first exposes port 6006:

```sh
bin/devcontainer rebuild
```

## Interface layers

Stories follow the production dependency direction:

```text
Pages -> Features -> Components
```

- **Components** are small reusable interface elements without product workflow knowledge.
- **Features** compose Components for one Hub responsibility and accept display-ready props.
- **Pages** compose complete Hub surfaces and accept typed page data.
- **Application adapters** read Superglue data and run application hooks before rendering Pages.

The sidebar groups stories by the surface being reviewed, not their implementation technology:

- `Components/Name` contains reusable interface elements, without Brand-based or Hub-built prefixes.
- `Prototype canvas/Name` contains the complete local canvas experience and its panels, dialogs, and controls.
- `Hub/Design/Name` contains Hub-wide overviews and inventories.
- `Hub/Pages/Name` contains complete Hub pages, including browser pages that approve canvas connections.
- `Hub/Features/Name` contains Hub workflow compositions.

Keep these groups when adding stories. The catalogue hierarchy does not change the production dependency direction or where story files live.

`Components/Replica Logo` presents `ReplicaLogo` from `app/javascript/components/replica-logo/` in one story with a size control. The logo uses the Hub foreground color. Small, medium, and large use 24px, 32px, and 48px marks at the standard 16px root size. Medium matches Figma node `150:1607`: a 32px mark, an 8px gap, and a 24px Mona Sans Medium wordmark. The original local SVG is shared through a CSS mask.

Pages and their stories must not read Superglue context directly. Storybook does not run authorization, requests, Action Cable subscriptions, or the preview bridge.

The `Hub/Pages/Security` stories assemble the same sidebar, account menu, and content frame as repository pages. For example, `Hub administrators / Multiple` shows repository navigation above the lower settings group, with **Collapse sidebar** directly above the avatar menu. `Hub/Features/Hub Administration Workspace / No Repositories` omits repository controls without changing the frame. `Audit / Repository` represents a repository-only admin; `Repository And Hub Admin` offers both audit scopes without combining their records. `Hub Only` and `Scopes Unavailable` show distinct limited choices. `Public sharing / Access Removed` retains independently permitted repository navigation but no Hub links or actions. `End all sessions / Ended` has no authenticated navigation. Use the theme and viewport controls to review the full layout. These fixtures represent authorized display states only and do not grant roles or perform GitHub operations.

The `Hub/Design/Banner inventory` story compares the repository workflow panel's six visible cases with Hub alert examples. The individual Workflow Installation and Alert stories remain available for inspecting each component and its controls.

`Hub/Pages/Security/Hub administrators` lists administrators only. **Add administrator** opens the searchable multi-select dialog with synthetic Hub users. `Hub/Features/Hub Administrators/Add administrators` covers empty, single, multiple, loading, and failed searches. Selection and confirmation work in these stories, but form submission is blocked and no roles are saved.

## Story data

Story fixtures use the Oaken personas as their source:

- `octocat` represents The Octocat.
- `mona` represents Mona Lisa.
- `github/prototype` contains `prototype/welcome` and its successful Build.
- `github/empty` represents an installed repository before its first prototype is published.

TypeScript fixtures mirror the display-ready values produced from these records. They do not load Ruby seeds or a database. Update the Storybook fixtures when a canonical Oaken persona changes.

Organize shared fixtures by the Hub domain they represent, such as users, repositories, prototypes, and Builds. Keep derived presentation data, such as the authenticated header, in its own module. Production copy belongs with its shared source, such as `utils/review-comment/en.ts`; stories import that copy rather than making runtime code depend on fixtures. Oaken remains the source for canonical personas but is not part of the TypeScript fixture structure.

Collection surfaces normally need only three stories:

1. Empty
2. Single
3. Multiple

Add another story only when it shows a meaningful product state, such as loading, failure, Build lifecycle, unavailable anchors, protected drafts, or a layout that changes at a narrow width. Use Storybook's theme and viewport controls instead of duplicating every story for dark mode or screen size.

## UI changes and pull request evidence

Hub and canvas UI changes are complete only when their Storybook coverage and PR screenshots match the change. This includes the extension's own screens, shared styles, copy, and interaction states, not just React component edits.

1. Compare the PR with its base and identify every affected presentation surface. Include stories whose output changes through shared components, styles, copy, or fixtures, even when their story file is untouched.
2. Update existing colocated stories for changed states and add stories for new states. Cover the meaningful states introduced or affected by the change, including loading, empty, failure, recovery, permissions, and pending or completed actions where applicable. Reuse production presentation code and isolated fixtures. Existing stories that already represent the changed UI need no artificial source edit.
3. Prune the affected catalogues in the same change. Agents remove stories for deleted or replaced UI, unreachable states, and examples with the same effective props and interactions as a retained story. Use theme and viewport controls for variants that only change those settings. Keep similar component and page stories only when they prove different presentation or integration behavior. Preserve supported fallback and permission states even if their names or appearance seem old. Remove orphaned story-only fixtures and update references; keep fixtures still used by tests or other stories. This cleanup is required whenever UI changes, without a separate user request.
4. Render every added or changed story from the final PR code. Reach its intended state, let assets and interactions settle, and inspect the result before capturing it. Use the [repository browser workflow](../../AGENTS.md#browser-validation-and-playwright-fallback) for agent-driven capture. A blank iframe, unintended loading placeholder, or failed story is a blocker, not evidence of the intended state. Stories deliberately showing loading or product errors should capture those states.
5. Upload the screenshots as GitHub attachments and embed them in a final `## Storybook screenshots` section at the bottom of the PR description. Label each image with its full Storybook title and story name, plus its theme and viewport. Include every added or changed story; use collapsible groups for large sets rather than representative samples. Choose a consistent theme and viewport, with additional captures when the change affects theme-specific or responsive behavior. Agents use the `github-pr-media` skill for uploads.
6. Refresh the screenshots after further UI edits. Before requesting review, reconcile the affected-story list with the story coverage and image captions. Reviewers check coverage, obsolete or duplicate stories, and evidence, including indirectly affected stories. If rendering or upload is blocked, name each missing story and the blocker in the PR; the evidence requirement remains incomplete.

Deleted stories need no after screenshot; explain removed UI in the PR. Omit the screenshot section when no story presentation changes. These are contributor and review requirements, not an automated CI coverage gate: a successful Storybook build does not prove state coverage or screenshot completeness.

## Story ownership

Keep `stories.tsx` beside the code it presents:

```text
app/javascript/features/review-comments-sidebar/
  index.tsx
  stories.tsx
  styles.css
  types.ts
```

Stories may use local state and Storybook fixtures. They must not fetch data, depend on repository access, mutate saved Hub data, or copy application orchestration into a second implementation.

Catalogue-only overview and inventory stories live under `app/javascript/storybook/`. Demo stories stay beside their demo, such as `storybook/inbox-prototype/stories.tsx`. The canvas application example stays beside `application/prototype-canvas/`. Preserve titles and exported story names when reorganizing files unless the catalogue hierarchy is intentionally changing. Intentional cleanup may rename, remove, or consolidate entries; update their references instead of retaining duplicate aliases.

`Hub/Pages/Inbox prototype` preserves the approved visual-only conversation-activity demo. In Workspace, hover or focus Inbox immediately after Prototypes to inspect the latest ten items under a compact Inbox and View all header. Unread rows use a muted green tint; counter badges consistently use the Hub's dark-green primary background with light text. The sidebar and inbox badges count all unread activity, including items outside those ten, update with local read controls, and disappear when nothing is unread; the collapsed sidebar keeps a compact count over the Inbox icon. Click Inbox or View all for the full-page list; All/Unread filters appear only on that page, and its scroll container reserves a stable scrollbar gutter across views. A triangular pointer-intent corridor keeps the card open while moving diagonally toward it, with a short grace period when the pointer stops outside. Clicking an activity from either surface opens its mock prototype and focuses and highlights the exact source message in a read-only conversation. This uses the authored static preview and shared message presentation, not real Hub routing. Empty and Collapsed Sidebar cover the other entry-point layouts. Filters and read controls change only in-memory sample data.

`Hub/Pages/Notifications` presents the production inbox Page with display-ready fixtures, including Empty, Single, Multiple, Loading, and Failure states. It shares the approved presentation with the demo but does not fetch notifications or authorize real links. Delivery, participation, cleanup, and read-state rules belong in [Review collaboration](review-collaboration.md#mentions-and-inbox); application and backend tests verify the live integration.

`Hub/Pages/Repositories/Create` and `Components/Template Card` use screenshots of the actual local seed layouts, not dashboard drawings. Create places the template picker inside the centered form and the searchable catalog below it, with Multiple, Single, No Preview, and search-empty states. Template Picker Open shows the dropdown, and Template Selected shows a non-Default selection. Narrow Desktop uses an 832-pixel viewport to check that grid columns follow the catalog's available width with the sidebar expanded. Local keeps prompt copying instead of the Copilot handoff. Their HTML and PNG fixtures live under `.storybook/preview-fixtures/templates/`. Regeneration requires the shared build action's installed Playwright dependency and the devcontainer's Chromium. Regenerate them inside the devcontainer with `node script/build-template-story-fixtures.mjs` after editing the authored examples. `Hub/Pages/Replica Browse/Template` displays that authored HTML in the existing preview and brief-composer shell.

For UI changes and PR evidence, follow the [coverage and screenshot workflow](#ui-changes-and-pull-request-evidence). Existing TypeScript tests remain responsible for behavior; Storybook makes presentation states available for design and accessibility review.

The `Prototype canvas` catalogue covers the local extension before and after connecting a preview. Server Connection renders the production React server controls with isolated in-memory responses for scanning, empty and populated server lists, script selection, startup output, pending operations and failures. It never scans this checkout, starts processes or connects to a real server. Publication Example's No Prototype stories keep the full canvas shell around the shared creation form and server controls, including disconnected, catalog loading and failure, optional details, template selection, and failed submission states. They also show each server connection state below the prompt: scanning, single and multiple servers, script selection and its open menu, warnings, unavailable startup, starting with CLI output, connecting, and failures. Both catalogues share the same server responses; isolated stories show the control itself, while full-canvas stories show its placement and interaction with the composer. Publication inputs remain in its scenario control. Detailed publication failure and eligibility states live in the owning dialog or panel stories instead of repeating the same application toolbar. Its preview URL can be configured with `VITE_STORYBOOK_PROTOTYPE_URL`.

Canvas recovery stories cover Controls compatibility, configuration, empty, reconnect, reset and diagnosis states; browser address and launch errors; Hub approval, URL save/reset and metadata failures; unavailable Build details and clipboard feedback; comment loading and recovery; and sharing permissions, expiry, validation and uncertain outcomes. Interaction stories perform the real UI action against fixture callbacks and retain the resulting state. Use the theme and viewport controls instead of separate light, dark or narrow copies.

`Prototype canvas/Controls fields` has interactive examples backed by the real controls runtime: All Fields covers all 11 control types; Conditional Fields shows one field in variant A and three in variant B, resetting hidden values; Actions demonstrates unavailable handlers, busy state, completion, and explicit failures. Each example shows live values and has a Reset example button. These stories do not exercise canvas persistence, the cross-frame bridge, or Hub integration.

Scope Dividers presents Copilot, Copilot onboarding, Composer, and Dashboard preview as four grouped scopes followed by an empty scope. Fold the groups or hide Dashboard to check that visible scopes share one divider per boundary, without a second border above the first group or a trailing divider for the empty scope. The onboarding action intentionally has no handler.

Scope Dividers Panel reuses those declarations in the real floating panel with its header Reset icon and no routine footer. Show Composer only to check a single group's first and last heading spacing, then restore all scopes to compare the first Copilot and final Dashboard headings. Expanded and collapsed headings keep the same hover height. Show ungrouped field adds a title before Copilot to compare the first-item spacing: group-first hover starts at the list's top edge, while an ungrouped first field retains 8px of outer top padding.

`Prototype canvas/Controls panel` presents the movable, nonmodal panel over an interactive preview. Movable covers dragging, keyboard movement, panel and group folding, toolbar dismissal, two unoutlined groups, ungrouped fields below them, live edits and Reset. Connection Failure shows the contextual recovery button. Page Specific mounts a shared layout plus either Dashboard or Details: their 320px and 440px widths override the shared set's 480px, inactive controls disappear, and returning to a page retains its values. Two shared fields appear first, then a divider instead of scope headings. Dashboard has a title field, two groups of two controls, and two ungrouped controls below them. The canvas Controls toggle uses the standard outlined icon-button style, matching Share. Layout is transient; no story writes saved controls or Hub data.

`Prototype canvas/Controls panel/All Controls` puts all 11 control types in the real floating panel over a basic notes page. Content controls change its title, description, item count, visibility, badges, and notes. Appearance controls change its layout, alignment, density, opacity, and accent color. Shuffle notes is a mounted action; the page also has an ordinary shuffle button independent of controls. Use this example to tune field sizing, including scrolling, group folding, panel folding, movement, and dismissal/reopen. Reset restores the declarations and shuffle count, not the panel layout. This story uses only in-memory state and does not exercise the cross-frame bridge or persistence.

Controls panel / Collapsed starts with only the header visible, including the Reset icon. Both it and Movable keep the Controls label and chevron at opposite ends of the same disclosure button with 8px horizontal insets. Reset is disabled at defaults, enables when controls or saved settings can be reset, and stays visible when collapsed. The separate grab handle has no tooltip; dragging and arrow-key movement remain available.

All Controls places Title and Description above Content as two ungrouped fields that remain visible when Content folds. It also places a longer "Presentation of the notes in each card" dropdown directly after Layout. Its long options compare long and short labels above their dropdowns and change the notes between short summaries and detailed descriptions.

Prototype fields use a dense treatment in both Hub and the canvas: 11px field and choice-group labels above inputs, 14px values, 12px checkbox/radio option text and normal-case collapsible group titles, 12px segmented-option text, 28px single-line inputs, color/slider rows, and segmented controls, and a two-row vertically resizable textarea. Collapsible groups have a divider above their title unless they are the first child, with no trailing group divider. Inputs use the theme-aware `--hub-canvas-muted` gray background and `--hub-border-muted` subtle border, preserving Brand focus, disabled, and validation states. Segmented controls fill the available field width with equal-width options and have a 2px inset around the selected background; its corner radius follows the outer border's radius and inset. Checkbox and radio visuals are 16px, vertically centered beside their labels in at least 24px clickable rows. Panel content uses 8px padding, except for the flush group-first top edge. A footer appears only for diagnosis or Retry actions and uses 8px padding with a theme-aware light gray background. Field gaps and input padding are reduced only within prototype controls; other Hub forms keep Brand defaults.

Text, textarea, number, slider-value and color inputs remain flat, without an inset shadow. Dropdown triggers and action-field buttons have a crisp 1px bottom shadow in black, followed by a lighter layer offset 2px down with a 2px blur. The two theme-aware layers use 3% and 2% black in light mode, or 28% and 5% in dark mode. Footer buttons retain their soft 1px shadow with a 2px blur. Dropdown menus and other buttons are unchanged. Segmented controls use the same thin muted border as inputs and dropdowns. Disabled and keyboard-focused controls retain their normal Brand treatment; ghost panel/group disclosures and the drag handle remain flat.

Action-field buttons use 12px text and, when enabled and resting, the same muted background, foreground and border tokens as dropdowns. Brand hover, pressed, focus and disabled treatments remain unchanged. Only buttons declared as controls receive this styling; Reset all controls, the toolbar Controls trigger and ordinary page buttons keep their existing treatment. Controls fields / Actions places a dropdown beside the action examples for comparison.

Unselected segmented labels use the muted foreground; the selected label keeps the default foreground. The selected segment and slider thumb share a thin muted border and soft shadow. Segment borders reserve their space before selection so changing options does not shift their labels. The slider has a 6px track with rounded ends and a white thumb. It remains a native range input with theme-aware track fill; value changes update the fill without changing its bounds, steps or keyboard behavior.

Number inputs are left-aligned below their field titles. Sliders place their editable value input to the right of the range track, below an 11px label. Slider value inputs hide spinner buttons and reserve no spinner space; ordinary number fields keep their spinners. Numeric width accommodates the declared bounds, signs, step precision, and padding; a maximum of 10 with integer increments reserves two digits rather than a fixed-width input. Slider and number input edits stay synchronized and share bounds and step validation. Missing step means 1; fractional controls declare a fractional step. Invalid or off-step drafts show validation without changing the app or slider and revert on blur. Slider and input each retain the field title as their accessible name. Validation appears below the input. Controls fields / Numeric Labels covers short and long titles for both types.

Dropdowns are left-aligned below their titles, using native intrinsic sizing based on the widest option rather than the selected value, and are capped at the available field width. Choice-group titles have an 8px gap before checkbox, radio, or segmented options. Checkbox and radio option labels remain beside their markers; wrappers use flex centering to remove inline baseline spacing around their visuals. Controls fields / Choice Rows covers short options, an unselected long option, long titles, and multiline radio labels.

Field and choice-group headings use 11px muted text, including Primer's nested group-label text. Checkbox/radio option text and normal-case collapsible group titles use 12px; collapsible titles use the default foreground token. The scrollable panel reserves a stable scrollbar gutter alongside its padding, preventing content-width changes when groups fold. Grid tracks, choice labels, and input wrappers shrink to the available width; long labels wrap and segmented options truncate. Horizontal scrolling is disabled; vertical scrolling uses `overflow-y: scroll` even when content fits. Operating-system settings may still auto-hide native overlay scrollbars.

Collapsible group headings align with the fields and use a rectangular gray hover background extending through both side paddings to the panel's left edge and right scrollbar gutter, and up to the divider above. Every heading has 8px top and bottom padding around a minimum 24px label row, including first, last and single-group scopes. The hover area stays the same size when expanded or collapsed; collapsed headings fill the space down to the next divider or the content edge. Padding does not depend on a following sibling. Every group has a divider above unless it is the first child of its scope, including the first group when ungrouped fields precede it. Groups followed by ungrouped controls have a divider below; adjacent groups share one divider, and the final group has no bottom divider. When present, the recovery footer retains its separate border. Group and scope dividers span the panel's side padding, stopping before the reserved scrollbar gutter without widening the scrollable layout. Native overlay and auto-hiding scrollbar behavior follows browser and operating-system settings. Group bodies add 4px of spacing below the heading plus room for the extended hover background.

Use segmented controls for two or three short labels, ideally a single short word each. Prefer a dropdown when two or more options are long words or phrases, and check that labels fit at the narrowest panel width. Segmented labels stay on one line and truncate overflow rather than splitting words; their full text remains the accessible name and native tooltip. This does not change the declared type or selected value. The Controls fields / Long Labels story compares both presentations. Authoring guidance also lives in the starter's `prototype-controls` skill.

`Hub/Features/Prototype Preview` owns the preview integration stories. With Controls and Minimized Controls embed a static app with public JSON definitions, the shared injected adapter and Hub panel. Their interaction opens the panel and waits for the Title field. Missing Controls Runtime opens Controls over a preview without the runtime and waits for the Build-specific connection error, without a Copilot diagnosis action. This is distinct from Controls panel / No Controls, which represents a connected runtime with no active declarations. Settings use the story's URL, never Hub data or real review state. The retired Build Controls catalogue is consolidated here. Regenerate the fixture bundle with `npm run controls:build`. This does not prove deployed Build authorization.

`Hub/Pages/Prototype Review/Hub Toolbar Controls` shows the complete alternative Hub workspace with that same static app: Controls is in the higher workspace header, while the prototype address bar retains Copy prototype link and Minimize Hub UI. `Minimized Hub Toolbar Controls` shows the toggle in the existing floating review bar. Both stories use a separate Storybook-only storage identity and no real review or authorization state.

The `Hub/Pages/Home` stories show the signed-out Primer Brand Hero with the Replica logo, its full entrance sequence, rotating label cursor, size-2 heading, GitHub sign-in icon, and access-alert state. The heading reveals first, followed by the description and sign-in action using Primer's native timings. The label changes between two phrases every six seconds. On wide screens, an unboxed two-tone dither field spans the page behind the left content. A shader-like density shape shifts through the fixed pixel grid. Dark mode starts on black with the deeper Replica greens; light mode uses the neutral light surface and brighter green treatment. Both modes follow the Hub theme control immediately. The colors hold for 12 seconds before a three-second curved Bayer wipe moves from right to left through Replica green, airy green, campaign blue, purple, and forest mint. The field sits below the content on narrow screens. Mouse movement gently steers the shape without crossing into the supporting copy. A corner control pauses or resumes the field, palette, and label animation. Reduced motion keeps the initial green field and label still, and hidden tabs suspend their animation. Touch input does not steer the field.
