# Appearance — 2.3.0

Light, dark and system modes share a color-token system across the sidebar, mobile drawer, account/confirmation dialogs, forms, tables, calendar and toasts. A darker header transitions into lighter page surfaces; dark mode keeps the same hierarchy with brighter text and a subdued navy/teal palette.

A header icon switches directly between light/dark. Settings contains accessible radio choices for Light, Dark and System. The selection persists locally per device and does not modify the journal document. System mode reacts to operating-system changes; explicit light/dark choices remain fixed. The initial preference is resolved before painting, with safe fallback when browser storage is unavailable. Native controls and browser theme color follow the selected mode.

Verification: all 19 sync/data tests; desktop and mobile browser flows at 1440, 390 and 320 px, extended to cover dark-mode layouts, reload persistence, system-theme changes and the header toggle. Visually inspected both palettes and dark-mode dialogs. No production journal data changed.
