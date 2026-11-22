# HE30 Pro v0.18 diagnostic result

On the physical keyboard, H3K18 cleared the v0.16 Save freeze by masking interrupts through the QingKe user-mode `GINTENR` register. Save then returned flash error 9 during the first page-buffer load. Use [v0.19](../he30-v0.19/README.md) for the updated writer. The [handoff](../../../docs/onboard-save-handoff.md) records both debugger captures.
