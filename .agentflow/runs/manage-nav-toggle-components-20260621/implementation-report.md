# Management Layout Toggle & Button Primitive Migration Report

## Summary of Changes
Implemented an explicit collapse/expand toggle on the desktop management sidebar and migrated raw, ad-hoc `<button>` elements to the shared `Button` primitive across the management UI.

---

## Changed Files

A total of 7 source files were modified. Build output changes in `packages/server/public/app` were successfully verified and then reverted to keep artifacts out of scope:

1. [Toolbar.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/Toolbar.tsx)
   - Implemented an `isCollapsed` state to control the desktop sidebar layout width (collapsing from `w-60` to `w-20` for a compact icon rail).
   - Added a collapse/expand toggle button using Lucide's `PanelLeftClose`/`PanelLeftOpen` icons with appropriate accessible titles/labels.
   - Updated navigation items to hide labels when collapsed while retaining accessible aria-labels and native tooltips.
   - Migrated all mobile drawer openers, closers, and links to use the shared `Button` primitive.
2. [DashboardPage.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/DashboardPage.tsx)
   - Replaced raw clickable card buttons in `StatusCard` with `Button` using style overrides (`variant="ghost"`, custom padding, and font-weight overrides).
   - Updated `StatusCard` responsively: applied mobile padding (`p-3 sm:p-5`), gaps (`gap-1.5 sm:gap-4`), a responsive value font size (`text-2xl sm:text-3xl`), kept icons contained (`p-1.5 sm:p-2.5` wrapper with `[&_svg]:h-4 [&_svg]:w-4 sm:[&_svg]:h-5 sm:[&_svg]:w-5`), removed any truncation/ellipsis, and stacked detail text vertically on mobile to let it wrap naturally without overflow.
   - Updated the grid layout to maintain a two-column layout on mobile (`grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4`).
   - Removed unnecessary truncation from the quick links under "次の確認" to ensure Japanese labels render fully.
3. [main.tsx (Manage)](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/main.tsx)
   - Migrated the toast close button and disabled layout undo/redo controls to the `Button` primitive.
4. [PendingTab.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/PendingTab.tsx)
   - Migrated the "PNGを追加" label to a `Button` triggering a hidden input ref for keyboard accessibility.
   - Converted the motion choices and direction selection elements inside `ReleaseFishDialog` to use the `Button` primitive.
5. [MotionPage.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/MotionPage.tsx)
   - Migrated `MotionCard` wrappers and the "カスタム泳ぎを追加" button to the `Button` primitive.
6. [FishTab.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/FishTab.tsx)
   - Converted the Close (X) icon button, motion types list, and direction selectors inside `FishConfigPopup` to the `Button` primitive.
7. [LayerOccupancySection.tsx](file:///Users/takumi/Develop/oekaki_aquarium/packages/frontend/src/manage/components/fish/LayerOccupancySection.tsx)
   - Converted the layer detail collapse header button and index delete buttons to the `Button` primitive.

---

## Design Decisions

- **Compact Sidebar Statistics**: In collapsed mode, the bottom panel layout is reduced to simplified icon/stat lines showing active counts of screens/fish, and connection state indicator with hover tooltips, preventing overflow or clipping.
- **Badge Dot Overlay**: When the sidebar is collapsed, the pending fish numeric badge is condensed into a small amber notification dot aligned to the top-right corner of the "承認待ち" icon.
- **Button Overrides**: We styled custom instances of the `Button` primitive utilizing `variant="ghost"` or `variant="outline"` combined with custom dimensions/margins so that visual card designs and inline tabular layouts are perfectly preserved.
- **Responsive Wrap & Layout Sizing Overrides**:
  - Explicitly resolved the `whitespace-nowrap` text regressions inherent in the `Button` primitive by appending `whitespace-normal` overrides to all card-like and multi-line button elements.
  - Optimized `StatusCard` contents at 390x844: removed all ellipsis/truncation, allowing values (such as `1130`, `33ms`, `245%`) and details to be fully visible inside card bounds. Detailing text uses a stacked flex direction on mobile (`flex-col items-start`) to allow multi-line wrapping naturally, ensuring readable text without truncating Japanese labels in quick links.

---

## Verification & Testing

### Exact Verification Run
```sh
# Typecheck
bun run typecheck
# Output:
# @aquarium/shared typecheck: Exited with code 0
# @aquarium/server typecheck: Exited with code 0
# @aquarium/frontend typecheck: Exited with code 0

# Production Build
bun run build
# (Vite bundle built successfully. All generated public/app outputs have been reverted/restored)

# Git Diff Check
git diff --check
# (Passed cleanly)
```

### Browser Checks (Simulator/Responsive DevTools)
1. **Sidebar Toggle (1440x900 & 1024x768)**:
   - Clicking the panel button collapses the navigation to an 80px rail, transitioning smoothly. Clicking it again expands it.
   - Toggle button can be focused by Tab/Shift+Tab and activated via Space and Enter.
   - Tooltips render correctly when hovering over collapsed destinations.
2. **Mobile Drawer (390x844)**:
   - Existing drawer, Escape close support, focus trap, and focus restoration behaviors remain fully functional.
3. **Migrated Controls & Responsive Wrap Validation**:
   - Focus rings, click actions, and accessibility parameters function correctly on all migrated page controls.
   - Non-interactive cards remain static div wrappers and do not accept keyboard focus.
   - Verified visually and via DOM geometry at viewports `390x844` (mobile 2-column layout), `768x1024`, `1024x768`, and `1440x900`: live values like `1130`, `33ms`, and `245%` render completely without truncation. Card elements wrap naturally, icons are neatly contained within borders, and all elements remain strictly within card/viewport bounds.
