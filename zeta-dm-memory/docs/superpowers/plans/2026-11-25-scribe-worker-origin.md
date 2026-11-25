# Worker lookup and fork delta

1. Use `ScribeBoot.forkSource` and `ScribeCloud.forkBook` to check the selected origin’s Worker head and download its Book parts. Test a stale local Book, an absent head, a rejected request and an unfinished Worker Book.
2. Use `ScribeKeeper.recoverFork`, `ZetaSource.history` and `ScribeFork.stage` to request the destination delta through its saved tip and match the Book’s recorded readings to destination IDs. Test a changed passage, differing IDs, legacy readings, a missing boundary and a stale destination missing new messages.
3. Update `ScribePanel` to present the two missing-origin choices. Exercise both buttons and verify there is no message request before the operator chooses.
4. Run the fork, boot, keeper, panel, Zeta source and whole userscript suites. Regenerate the installable using `node scribe/pack.mjs` after the feature is complete and check source parity.
