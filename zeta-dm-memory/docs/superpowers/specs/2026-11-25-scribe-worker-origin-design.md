# Pull the selected origin Book from the Worker

The operator selects an origin room. Scribe reads the Worker record for that exact room ID using its configured authenticated connection. A successful lookup supplies the Book for recovery, including readings from a Book still in progress.

When the Worker reports that the room has no Book, Scribe displays **Choose a different origin** and **Pull chat data**. Only the operator's selection starts either action. A failed Worker request shows its error.

For a fork with saved destination history, fetch the destination delta through its own saved boundary. Match the origin Book’s recorded readings to destination passages using the Book’s content fingerprints, recorded order and available positional receipts. Leave fork-only passages for normal processing. Room selection uses the origin room ID, and passage mapping accommodates different message IDs.

When a fork has no verified saved destination history boundary (such as a fresh fork, a second device with no complete local history, or partial, unjoined, mismatched, or suspect local state), Scribe pulls the destination room’s complete history from Zeta, clears any stale queued observations, and verifies the origin Book against that transcript.
