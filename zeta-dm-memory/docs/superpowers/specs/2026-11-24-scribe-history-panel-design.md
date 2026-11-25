# Check history in the Progress panel

The Progress panel currently prints `undefined` above two required number fields. Their position directly after the pull controls makes them look like prerequisites for pulling the chat.

Place the fields and their action together under the heading **Check history**. Between the heading and fields, show this instruction.

> To check specific messages from your last pull, enter the first and last message numbers. Leave these blank to pull the chat.

Keep **From message**, **To message**, their required markers and the **Check history** button together. Show the entire group when a manual pull has provided a message range. **Pull the chat again** stays in the general controls and works with both fields blank.

Deliver this change in the installable userscript as well as the panel source. The fork recovery work has its own design and release scope.
