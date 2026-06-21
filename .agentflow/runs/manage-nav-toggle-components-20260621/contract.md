# Implementation Contract

## Objective

Improve the management UI by:

1. Adding an explicit user-controlled navigation collapse/expand toggle at desktop widths, while retaining the existing small-screen drawer behavior.
2. Rebuilding management-screen button controls with the repository's existing `Button` primitive wherever they currently use ad-hoc raw `<button>` styling.
3. Preserving the existing visual hierarchy, routes, behavior, responsive layout, accessibility, and all uncommitted fixes already present in the workspace.

## Repository Findings

- Workspace: `/Users/takumi/Develop/oekaki_aquarium`.
- The workspace currently contains the user's previous, approved uncommitted UI fixes. They must be preserved.
- There is no workspace `tools/agentflow.py`; this contract is executed through `agy --sandbox` in the target cwd.
- Existing shared button primitive:
  - `/Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/components/ui/button.tsx`
  - Supports `default`, `destructive`, `outline`, `secondary`, `ghost`, `link` and `default`, `sm`, `lg`, `icon`.
- Current management navigation:
  - `/Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/Toolbar.tsx`
  - Desktop: fixed `w-60` sidebar.
  - Below `lg`: top bar and accessible modal drawer.
  - The mobile menu already implements Escape, focus trap, and focus restoration.
- Raw styled `<button>` elements remain in the management UI:
  - `Toolbar.tsx`
  - `DashboardPage.tsx`
  - `PendingTab.tsx`
  - `MotionPage.tsx`
  - `FishTab.tsx`
  - `LayerOccupancySection.tsx`
  - `manage/main.tsx`
- Project constraints:
  - Use existing UI primitives first.
  - Do not change visual hierarchy unless requested.
  - Preserve APIs, WebSocket messages, state architecture, and canvas behavior.

## In Scope

### Navigation toggle

- Add an explicit collapse/expand toggle to the desktop management sidebar.
- Expanded state remains approximately 240px wide and displays icons, labels, counts, and connection details.
- Collapsed state becomes a compact icon rail, approximately 64–80px wide, without hiding navigation destinations.
- Use the existing `Button` primitive for the toggle and navigation actions.
- Every icon-only action must have an accessible name and visible focus treatment.
- Add native `title` text or an existing tooltip primitive if available so collapsed navigation remains discoverable with a pointer.
- Keep the current mobile/tablet drawer behavior below `lg`; use the shared `Button` primitive for opener, closer, and drawer navigation.
- The desktop toggle is a user choice, not only an automatic breakpoint behavior.
- State may remain session-local React state; do not add persistence unless it is trivial and does not create hydration or cross-window issues.

### Existing Button primitive migration

- Audit the management UI raw `<button>` elements listed above.
- Replace button-shaped interactive controls with the existing `Button` component.
- Preserve card-like interactions and selected-state appearance by using `Button` plus scoped `className` overrides where appropriate.
- Keep non-interactive status cards as semantic non-buttons.
- Preserve exact click handlers, disabled state, keyboard behavior, labels, and layout.
- Do not mechanically replace elements where the shared `Button` primitive would damage semantics or layout; document any intentional exclusions.

## Out of Scope

- No server, API, WebSocket, shared-type, persistence, display rendering, fish behavior, or canvas changes.
- No new component library or dependency.
- No redesign of colors, typography, content, information architecture, page routes, or card layouts.
- Do not replace form controls, sliders, tabs, selects, or checkboxes beyond this button-focused request.
- Do not modify generated files under `packages/server/public/app`.
- Do not commit, stage, push, or discard the existing uncommitted user changes.

## Technical Design

### Desktop sidebar state

- Add a single source of truth for desktop collapsed state inside `Toolbar` unless composition requires lifting it.
- Expanded and collapsed widths should transition without shifting or clipping the main content unexpectedly.
- In collapsed mode:
  - center nav icons;
  - visually hide labels but retain accessible names;
  - keep active-state styling;
  - show pending count in a compact badge if nonzero;
  - reduce or simplify bottom statistics without losing accessible status information;
  - expose a toggle whose accessible label changes between “ナビゲーションを折りたたむ” and “ナビゲーションを展開”.
- Use lucide icons already installed, such as panel-left close/open icons, rather than custom SVG.

### Shared Button usage

- Import `Button` from `@/components/ui/button`.
- Prefer `variant="ghost"` for sidebar and low-emphasis actions, `outline` for bordered controls, and existing destructive/default variants where already appropriate.
- Override dimensions and alignment through `className` only where the existing component API is insufficient.
- Avoid recreating focus rings manually unless required by dark-background contrast.

## File-Level Plan

- `packages/frontend/src/manage/components/Toolbar.tsx`
  - Implement desktop toggle and migrate all navigation controls to `Button`.
- `packages/frontend/src/manage/components/DashboardPage.tsx`
  - Use `Button` for actionable status cards and quick-navigation rows; keep static status cards non-interactive.
- `packages/frontend/src/manage/main.tsx`
  - Replace ad-hoc toast close and disabled undo/redo controls with `Button`, preserving behavior.
- `packages/frontend/src/manage/components/PendingTab.tsx`
  - Replace movement/type choice raw buttons with `Button`, preserving selected states.
- `packages/frontend/src/manage/components/MotionPage.tsx`
  - Replace custom preset/card buttons with `Button`, preserving card layout.
- `packages/frontend/src/manage/components/FishTab.tsx`
  - Replace icon/segmented raw buttons with `Button`, preserving exact behavior.
- `packages/frontend/src/manage/components/fish/LayerOccupancySection.tsx`
  - Replace disclosure/delete raw buttons with `Button`, preserving compact layout.
- Additional management files may be edited only if a raw management button was missed and the change is direct and mechanical.
- Update `.agentflow/runs/manage-nav-toggle-components-20260621/implementation-report.md`.

## Acceptance Criteria

1. At 1440x900, the desktop sidebar has a visible collapse/expand toggle.
2. Activating the toggle collapses the sidebar to an icon rail and expands the main content.
3. Activating it again restores the full sidebar.
4. All six navigation destinations remain reachable and operable in both states.
5. The active destination, pending badge, and connection state remain understandable in collapsed mode.
6. Toggle works with mouse, Enter, and Space; it has a state-appropriate accessible name.
7. At 390x844 and 768x1024, the existing drawer pattern still works, including focus trap, Escape close, item-close, and focus restoration.
8. Management button-shaped controls in the audited files use the shared `Button` primitive unless explicitly documented as a semantic/layout exception.
9. Non-interactive dashboard cards remain outside the Tab sequence.
10. No horizontal overflow, clipped controls, console errors, or page errors are introduced at 390x844, 768x1024, 1024x768, and 1440x900.
11. Existing Guest and Controller fixes remain unchanged.
12. `bun run typecheck`, `bun run build`, and `git diff --check` pass.
13. Generated build output is restored after build verification, leaving only intended source changes and `.agentflow` artifacts.

## Exact Verification

Run:

```sh
bun run typecheck
bun run build
git diff --check
```

After build verification, restore all generated differences under:

```text
packages/server/public/app
```

Browser validation:

- `/manage` at 1440x900:
  - collapse with pointer;
  - expand with pointer;
  - repeat using Enter and Space;
  - navigate all six destinations in collapsed mode;
  - confirm static cards are not buttons.
- `/manage` at 1024x768:
  - verify breakpoint behavior and no clipping.
- `/manage` at 768x1024 and 390x844:
  - verify drawer, Escape, Tab/Shift+Tab focus trap, item close, focus restoration.
- Inspect console and page errors.

## Risks / Open Questions

- Compact sidebar statistics require judgment. Preserve meaning and accessible text without forcing all expanded content into the rail.
- Shared `Button` has `whitespace-nowrap` and default height rules. Card-style buttons may need explicit `h-auto`, `whitespace-normal`, `justify-start`, and `text-left`.
- Do not expand this into a full design-system rewrite. This task covers the management navigation and identified raw management buttons only.
