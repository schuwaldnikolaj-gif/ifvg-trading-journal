# UI interactions — 2.2.0

Account creation and editing now use one validated dialog for name, broker, type, start capital and daily risk limits. Custom legacy account types are preserved when editing. A cancelled dialog does not change the journal.

On mobile, a four-item quick navigation replaces the previous eight-item grid. The hamburger opens a native modal drawer containing every section. Selection closes it; Escape and the close button restore normal interaction. Desktop retains the sidebar. Native dialog focus containment, labeled headings, background scroll locking and reduced-motion support apply throughout.

Journal deletion, backup replacement, legacy recovery and risk-limit overrides use explicit confirmations. Asynchronous operations recheck ownership before writing; switching users closes open dialogs. Trade submission is guarded against duplicate saves.

Dismissible monochrome toasts distinguish saved-on-device, cloud progress, manual cloud completion and errors. They are capped at three, pause their dismissal timer on hover/focus and announce via status/alert roles. Polling does not produce recurring toasts. A failed device-storage write suppresses the saved toast and preserves the error state.

Verification: 19 data/sync tests; Chromium flows at 1440×900, 390×844 and 320×740 covering navigation, drawer Escape/focus restoration, account cancellation/validation/create/edit, trade persistence, deletion cancellation/confirmation and backup cancellation/restoration. Visual review of dialog, drawer and toast at mobile and desktop widths. The external SMTP provider and physical-device keyboard behavior are not covered by these browser checks.
