# Speed save and polling

P1: A background refresh while a web speed selection is saving must not strand the selector disabled, suppress a save error, or replace the committed selection with an older response. The next inference uses the selected tier. Model/session changes still invalidate old responses.

The web layout and TUI behavior remain unchanged. This race is browser-only; TUI has no background polling. Existing terminal picker and wire tests remain release checks.

The regression drives the actual DSH web picker and handler with loopback inference, holds a PUT response, triggers the 30-second polling callback and verifies recovery and the next outgoing request for Sol/Fast and Astra/Ultrafast. Existing client tests cover model changes and revoked tiers. No live inference is used.

Target: installed DSH 0.2.1-alpha.2, dsh-TUI 0.14.0, pi-ai 1.1.0. Keep the installed alpha exception. Install on personal Mac first; fleet promotion waits for Jake's acceptance.
