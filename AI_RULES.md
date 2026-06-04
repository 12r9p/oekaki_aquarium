# AI Development Rules

## Scope Control

- Do not modify unrelated screens.
- Do not refactor and change UI behavior in the same task.
- If a change touches more than 5 files, explain why before proceeding.
- Preserve public API, WebSocket message formats, and shared types unless explicitly requested.

## Frontend Architecture

- Do not add direct fetch calls inside UI components.
- Use shared API modules under `src/shared/api`.
- Keep page components responsible for composition only.
- Keep Canvas rendering, hit-testing, and drag behavior in separate modules.
- Do not store hidden cross-component state on `window`.

## State Management

- Manage screen state should have one source of truth.
- Do not create another WebSocket client for the same page.
- Do not duplicate state between React local state and Zustand unless there is a documented reason.

## Type Safety

- Do not use `any` unless the boundary is truly unknown.
- Do not use `@ts-ignore`.
- If a WebSocket message requires `@ts-ignore`, update `@aquarium/shared` types instead.

## UI

- Use existing `components/ui` primitives first.
- Do not hardcode random colors when a design token or existing class exists.
- Do not change visual hierarchy unless explicitly requested.

## Canvas

- Do not mix drawing, hit-testing, drag mutation, and React state updates in one function.
- Keep coordinate conversion functions pure.
- Keep hit-test functions deterministic and independently testable.