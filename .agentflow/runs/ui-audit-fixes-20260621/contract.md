# Implementation Contract

## Objective

Fix the five UI/UX defects confirmed by the Supervisor's browser audit:

1. Make `/manage` usable at 390px and tablet widths without compressing the main content behind the fixed 240px sidebar.
2. Ensure one physical tap on `/guest` creates exactly one food-spawn action and increments the visible count exactly once.
3. Make the image upload controls on `/controller` and `/guest` keyboard reachable and operable.
4. Render dashboard status cards without actions as non-interactive content, while preserving button behavior for navigable cards.
5. Restore browser zoom support on the Guest and Controller pages.

## Repository Findings

- Workspace: `/Users/takumi/Develop/oekaki_aquarium`
- Frontend stack: React 18, TypeScript, Vite MPA, Tailwind CSS, Radix primitives.
- Project rules: `/Users/takumi/Develop/oekaki_aquarium/AI_RULES.md` and `.claude/CLAUDE.md`.
- Management shell: `packages/frontend/src/manage/main.tsx`.
- Fixed management navigation: `packages/frontend/src/manage/components/Toolbar.tsx`, currently `w-60 flex-shrink-0`.
- Dashboard card always renders `<button>`: `packages/frontend/src/manage/components/DashboardPage.tsx`, `StatusCard`.
- Guest feed surface binds both `onClick` and `onTouchStart`: `packages/frontend/src/guest/main.tsx`.
- Upload controls use `Button asChild` with a `<label>` wrapping a hidden file input:
  - `packages/frontend/src/controller/Gallery.tsx`
  - `packages/frontend/src/guest/main.tsx`
- Zoom is disabled in:
  - `packages/frontend/controller.html`
  - `packages/frontend/guest.html`
- Existing audit results:
  - At 390x844, `/manage` main content starts at x=240 and is only 150px wide on every management page.
  - One touch on `/guest` produced visible text `エサ投入 2回`.
  - Upload labels were absent from the Tab sequence.
  - Non-navigable dashboard cards appeared in the Tab sequence.
- Baseline `bun run typecheck` passes.

## In Scope

- Responsive management shell/navigation behavior for desktop, tablet, and phone.
- Guest feed event handling and keyboard-accessible upload trigger.
- Controller keyboard-accessible upload trigger.
- Dashboard `StatusCard` semantics.
- Removal of `user-scalable=no`.
- Small focused automated tests if compatible with the current repository tooling.

The expected change may touch more than five files because the five independently verified defects span the management shell, dashboard component, two separate application entry points, and two HTML viewport declarations. Do not broaden this into a visual redesign.

## Out of Scope

- No API, WebSocket protocol, server, shared-type, physics, or persistence changes.
- No change to the information architecture, wording, visual brand, or desktop management hierarchy beyond what responsive usability requires.
- No changes to Canvas drawing, hit-testing, drag behavior, fish behavior, or display rendering.
- No dependency additions unless strictly necessary and justified; prefer existing primitives and native React/HTML behavior.
- Do not commit, push, or modify unrelated files.

## Technical Design

### Responsive management navigation

- Preserve the current 240px sidebar at desktop widths.
- At small widths, replace it with an intentional compact navigation pattern that leaves the main content at a usable width. Preferred solution:
  - a top app bar with a menu button and an accessible dismissible navigation drawer/overlay, or
  - another established responsive pattern using existing primitives.
- The menu control must have an accessible name.
- The drawer/menu must close after selecting a destination and support Escape when open.
- Avoid permanently rendering the 240px sidebar beside content at phone widths.
- Preserve all six navigation destinations, counts, and connection status.

### Guest input

- Use a single pointer/click activation path so a touch produces one `spawn_food` message and one count increment.
- Preserve mouse support.
- Ensure activating the “自分の魚を放流する” button does not also spawn food.

### Upload controls

- Use an actual keyboard-focusable button to trigger a visually hidden file input through a ref, or an equivalently semantic native implementation.
- Enter and Space must open the file chooser.
- Keep camera capture, accepted types, multiple-selection behavior, and existing upload logic unchanged.

### Dashboard cards

- If `onClick` exists, render the card as a button.
- If `onClick` is absent, render non-interactive semantic content with identical styling.

### Zoom

- Change both viewport declarations to `width=device-width, initial-scale=1.0` without disabling user scaling.

## File-Level Plan

- `packages/frontend/src/manage/components/Toolbar.tsx`
  - Add responsive navigation behavior and required accessible controls.
- `packages/frontend/src/manage/main.tsx`
  - Hold minimal mobile navigation state only if required for composition.
- `packages/frontend/src/manage/components/DashboardPage.tsx`
  - Make `StatusCard` element semantics conditional on `onClick`.
- `packages/frontend/src/guest/main.tsx`
  - Remove duplicate touch activation; make upload activation keyboard accessible.
- `packages/frontend/src/controller/Gallery.tsx`
  - Make upload activation keyboard accessible.
- `packages/frontend/guest.html`
  - Restore zoom.
- `packages/frontend/controller.html`
  - Restore zoom.
- Focused test files may be added only if they validate these behaviors without requiring unrelated infrastructure.

## Acceptance Criteria

1. At viewport 390x844, `/manage` main content has a usable width and is not permanently reduced to approximately 150px by the navigation.
2. At viewport 1440x900, the management sidebar and existing hierarchy remain functionally equivalent.
3. All six management destinations remain reachable at phone width.
4. If the phone navigation opens as a drawer/menu, Escape closes it and selecting an item closes it.
5. One touchscreen tap on the guest feed surface changes the count from zero to exactly `エサ投入 1回`.
6. Clicking/tapping “自分の魚を放流する” changes mode without incrementing the feed count.
7. Controller and Guest image upload actions are reachable by Tab and activatable by Enter/Space.
8. Dashboard cards with navigation remain keyboard-focusable buttons; cards without `onClick` are absent from the Tab sequence.
9. Guest and Controller HTML no longer contain `user-scalable=no`.
10. No horizontal overflow, console errors, or page errors are introduced on audited routes.
11. `bun run typecheck` and `bun run build` pass.
12. The final git diff contains no unrelated changes.

## Exact Verification

Run:

```sh
bun run typecheck
bun run build
git diff --check
```

Browser validation against `bun run dev`:

- `/manage`: 1440x900, 768x1024, 390x844.
- `/controller`: 1024x768 and 390x844.
- `/guest`: 390x844 with touch emulation.
- Verify Tab, Shift+Tab, Enter, Space, and Escape where applicable.
- Verify one touch creates exactly one feed count increment.
- Inspect console and page errors.

## Risks / Open Questions

- There is no existing mobile management navigation primitive, so implement the smallest accessible responsive shell consistent with current Tailwind conventions.
- The display and management WebSocket clients can persist runtime state during browser tests. Do not leave audit-only display IDs or other runtime data changes in tracked files.
- Browser file choosers cannot always be visually opened in headless mode; validate activation through the file chooser event or by assigning a test file to the input.
- No user decision is required: the responsive navigation behavior is an implementation detail, while the existing destinations and hierarchy must be preserved.
