# Zeta DM notes API

Private per-room notes storage for the Zeta AI Tampermonkey script. This package includes the installable userscript, Cloudflare Worker, and D1 schema. The injection interval, turn counter, inject-next flag, and collapsed state stay in each browser.

## Install or update the userscript

1. Open [zeta-dm-memory.user.js](zeta-dm-memory.user.js). In the Tampermonkey dashboard, replace the contents of the existing script with this version and save. The name and namespace match v1.2. Keep one enabled copy.
2. Version 1.4 also matches `https://frame.pingpong.ai/*`. Zeta now serves its chat box from that frame inside the room page, so Tampermonkey runs the script there as well. The room page keeps the notes, counter, and widget. The copy in the frame only watches the chat box and its **Send** button and writes notes when the room page asks. Mouse sends count only while that button is labeled **Send**, so in another site language only Enter sends count.
3. When Tampermonkey prompts for a connection, allow only the Worker host listed in the script, `zeta-dm-memory.elit1989.workers.dev`.
4. On Zeta AI, select **Set DM API key** from the Tampermonkey menu and enter your Worker key. Repeat in each browser. The native prompt shows the key as you type. Keep it out of screenshots.
5. Reload a Zeta room. The widget reads cloud notes for its exact pathname. Without a key, the widget keeps working with browser-local notes.

Edits save locally as you type. Cloud saving waits for 500 ms without a notes change and for input composition to finish. Clearing the field saves an empty note. The status next to **Import** shows whether notes are loading, saving, saved, or need attention.

Use **Import** to browse saved room IDs and timestamps, 25 at a time. Select another room, then choose **Import** again. Confirm to replace different nonempty notes, including when the source is empty. The copy saves to the open room after the normal delay. Later edits to either room are independent.

If local and cloud notes differ from the last synced version, the widget shows the cloud text. **Use cloud notes** asks before replacing your local draft. **Keep my notes** attempts a save against the revision shown and can surface a newer conflict. The same choices apply when the first read finds different legacy notes.

Temporary failures retry with backoff. Use **Retry notes sync** from the Tampermonkey menu after a stopped attempt or a local storage failure. Keep the tab open while **Local save failed** is visible so the in-memory draft stays available for retry. For a rejected key, check the Worker key and set it again through the menu.

## API

Send every request over HTTPS with `Authorization: Bearer <DM_API_KEY>`. The configured and supplied keys must be 60–254 characters long and use visible ASCII (U+0021 through U+007E). All ASCII punctuation is accepted literally. Send the key as-is after the single space, without quoting, escaping, or URL-encoding it.

The room ID is the exact `window.location.pathname`, encoded as a query parameter. For example, a pathname containing the literal characters `%2F` travels as `%252F` in the query value.

| Request | Successful response |
| --- | --- |
| `GET /v1/memory?roomId=%2Frooms%2Falpha` | `200` with the current room record |
| `PUT /v1/memory?roomId=%2Frooms%2Falpha` | `201` for a new room or `200` for an existing room, with the accepted room record |
| `GET /v1/memories?limit=25&after=%2Frooms%2Falpha` | `200` with a page of room metadata in binary room-ID order |

Send PUT with `Content-Type: application/json` and exactly these fields. The revision must be a nonnegative safe integer. Decimal or exponent notation is valid when it represents that integer exactly, as in `1.0` or `1e0`. Use revision `0` to create a missing room.

```json
{"notes":"Fictional session notes","expectedRevision":0}
```

The GET and PUT room responses use this shape.

```json
{"roomId":"/rooms/alpha","notes":"Fictional session notes","revision":1,"updatedAt":"2026-11-10T10:00:00.000Z"}
```

Use the current revision to replace the notes. Saving identical text at the current revision preserves its revision and timestamp. To clear the notes, save `""` at the current revision. A missing room returns `404 memory_not_found`. A stale save or a second create returns `409`.

```json
{"error":{"code":"revision_conflict","message":"Notes changed elsewhere. Reload before saving."}}
```

If a save response is lost and the retry conflicts, read the current room and compare its notes with the intended text before deciding whether to retry.

The list defaults to 25 items and accepts a limit from 1 to 50. Omit `after` for the first page. URL-encode `nextCursor` into the next `after` parameter. A final page has `nextCursor: null`.

```json
{"items":[{"roomId":"/rooms/beta","revision":2,"updatedAt":"2026-11-10T10:00:01.000Z"}],"nextCursor":null}
```

Room IDs are 1–512 UTF-8 bytes, start with `/`, and exclude whitespace, control characters, backslashes, `?`, and `#`. Notes preserve valid Unicode and whitespace up to 65,536 UTF-8 bytes. PUT bodies can contain at most 524,288 bytes. The API applies a shared limit of 180 authenticated, valid requests per UTC minute and returns `429` with `Retry-After` when full.

## Deploy through the Cloudflare dashboard

1. Confirm the existing Worker is on the Free plan, with its D1 database bound as `DB` and its existing Worker Secret named `DM_API_KEY`.
2. Open that database's D1 Console and run the reviewed [schema.sql](schema.sql).
3. Open the Worker's **Edit Code** view. Replace the Hello World module with [worker.mjs](worker.mjs), preserve both bindings, and deploy.
4. Open a protected route in the browser without credentials. Expect `401`. Run the authenticated checks below against your Worker origin.

The dashboard flow uses the existing account and bindings. It requires no CLI, account API token, Git connection, payment entry, or additional binding. Keep the key in the Worker Secret and out of URLs, files, output, and screenshots.

## Operator-run hosted checks

Run this in PowerShell 7.2 or newer. Enter the HTTPS origin of your deployed Worker when prompted. PowerShell accepts the key as a SecureString and constructs the bearer header in process memory. The checks create two unique fictional rooms that remain in storage because the API has no delete endpoint. The checks use a small number of requests to stay within the Free-plan quota.

```powershell
$origin = [uri](Read-Host 'Enter your HTTPS Worker origin')
if (!$origin.IsAbsoluteUri -or $origin.Scheme -ne 'https' -or $origin.UserInfo -or
    $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) {
    throw 'Enter the HTTPS origin without credentials, a path, a query, or a fragment.'
}
$base = $origin.GetLeftPart([System.UriPartial]::Authority)
$key = Read-Host 'Enter DM_API_KEY' -AsSecureString
$wrongKey = ConvertTo-SecureString -AsPlainText -Force -String (
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
)
$fixtureId = [guid]::NewGuid().ToString('N')
$roomA = '/rooms/verification-' + $fixtureId + '-alpha'
$roomB = '/rooms/verification-' + $fixtureId + '-beta'
$uriA = $base + '/v1/memory?roomId=' + [uri]::EscapeDataString($roomA)
$uriB = $base + '/v1/memory?roomId=' + [uri]::EscapeDataString($roomB)
$request = @{ SkipHttpErrorCheck = $true; MaximumRedirection = 0 }
$bearer = @{ Authentication = 'Bearer'; Token = $key }

function Assert-NotesCheck([bool]$Condition, [string]$Check) {
    if (!$Condition) { throw "Check failed - $Check" }
}

function Send-NotesCheck([string]$Uri, [string]$Notes, [long]$Revision) {
    $body = @{ notes = $Notes; expectedRevision = $Revision } | ConvertTo-Json -Compress
    Invoke-WebRequest @request @bearer -Uri $Uri -Method Put -ContentType 'application/json' -Body $body
}

try {
    $noKey = Invoke-WebRequest @request -Uri $uriA
    Assert-NotesCheck ($noKey.StatusCode -eq 401) 'missing key returns 401'

    $createA = Send-NotesCheck $uriA 'Fictional alpha' 0
    $createB = Send-NotesCheck $uriB 'Fictional beta' 0
    Assert-NotesCheck ($createA.StatusCode -eq 201 -and $createB.StatusCode -eq 201) 'both rooms were created'
    $readA = Invoke-WebRequest @request @bearer -Uri $uriA
    $readB = Invoke-WebRequest @request @bearer -Uri $uriB
    $initialA = $readA.Content | ConvertFrom-Json
    $initialB = $readB.Content | ConvertFrom-Json
    Assert-NotesCheck ($readA.StatusCode -eq 200 -and $initialA.roomId -ceq $roomA -and
        $initialA.notes -ceq 'Fictional alpha' -and $initialA.revision -eq 1) 'alpha read'
    Assert-NotesCheck ($readB.StatusCode -eq 200 -and $initialB.roomId -ceq $roomB -and
        $initialB.notes -ceq 'Fictional beta' -and $initialB.revision -eq 1) 'beta read'

    $replace = Send-NotesCheck $uriA 'Fictional alpha replacement' $initialA.revision
    $changed = $replace.Content | ConvertFrom-Json
    Assert-NotesCheck ($replace.StatusCode -eq 200 -and $changed.revision -eq 2) 'replace alpha'
    $stale = Send-NotesCheck $uriA 'Fictional stale write' $initialA.revision
    Assert-NotesCheck ($stale.StatusCode -eq 409) 'stale revision returns 409'
    $current = Invoke-WebRequest @request @bearer -Uri $uriA
    $currentA = $current.Content | ConvertFrom-Json
    Assert-NotesCheck ($current.StatusCode -eq 200 -and $currentA.revision -eq $changed.revision -and
        $currentA.notes -ceq 'Fictional alpha replacement') 'stale write left alpha unchanged'

    $same = Send-NotesCheck $uriA $currentA.notes $currentA.revision
    $sameA = $same.Content | ConvertFrom-Json
    Assert-NotesCheck ($same.StatusCode -eq 200 -and $sameA.revision -eq $currentA.revision -and
        $sameA.updatedAt -eq $currentA.updatedAt) 'identical save preserved metadata'
    $clear = Send-NotesCheck $uriA '' $currentA.revision
    $clearedA = $clear.Content | ConvertFrom-Json
    Assert-NotesCheck ($clear.StatusCode -eq 200 -and $clearedA.notes -ceq '' -and
        $clearedA.revision -eq 3) 'empty save'
    $checkB = Invoke-WebRequest @request @bearer -Uri $uriB
    Assert-NotesCheck ($checkB.StatusCode -eq 200 -and
        ($checkB.Content | ConvertFrom-Json).notes -ceq 'Fictional beta') 'beta remained independent'

    $indexUri = $base + '/v1/memories?limit=1'
    $first = Invoke-WebRequest @request @bearer -Uri $indexUri
    $firstPage = $first.Content | ConvertFrom-Json
    Assert-NotesCheck ($first.StatusCode -eq 200 -and $firstPage.items.Count -eq 1 -and
        $firstPage.nextCursor -ceq $firstPage.items[0].roomId) 'first page and cursor'
    $afterUri = $indexUri + '&after=' + [uri]::EscapeDataString($firstPage.nextCursor)
    $second = Invoke-WebRequest @request @bearer -Uri $afterUri
    $secondPage = $second.Content | ConvertFrom-Json
    Assert-NotesCheck ($second.StatusCode -eq 200 -and $secondPage.items.Count -eq 1 -and
        $secondPage.items[0].roomId -cne $firstPage.items[0].roomId) 'next page'
    foreach ($page in @($firstPage, $secondPage)) {
        Assert-NotesCheck ((($page.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'items,nextCursor') 'page fields'
        Assert-NotesCheck ((($page.items[0].PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'revision,roomId,updatedAt') 'metadata fields'
    }

    $badKey = Invoke-WebRequest @request -Uri $uriA -Authentication Bearer -Token $wrongKey
    Assert-NotesCheck ($badKey.StatusCode -eq 401 -and
        ($badKey.Content | ConvertFrom-Json).error.code -eq 'unauthorized') 'wrong key returns 401'
    'Hosted API checks passed.'
} finally {
    $bearer.Clear()
    $key.Dispose()
    $wrongKey.Dispose()
}
```

## Verify locally

Use Node.js 24 from this directory. The Worker and tests require no package installation.

| Command | Authorization and coverage |
| --- | --- |
| `node --check worker.mjs` | Database-free syntax check |
| `node --test tests/http.test.mjs` | Database-free HTTP, validation, and bound-statement control flow with a scripted adapter |
| `node --test tests/sqlite.test.mjs` | Operator execution or exact-command approval required. Runs the production SQL in isolated in-memory SQLite databases with controlled request interleavings. |

The SQLite suite exercises real SQL and controlled scheduling in one process. Cloudflare's distributed runtime and D1 response behavior require the hosted checks. See the [verification record](docs/verification/api-verification.md).

Run these database-free userscript checks from this directory in PowerShell.

```powershell
& 'C:/Program Files/nodejs/node.exe' --check zeta-dm-memory.user.js
& 'C:/Program Files/nodejs/node.exe' --test tests/userscript.test.mjs tests/userscript-frame.test.mjs
```

The userscript tests run the installed source in a Node VM with controlled browser events, time, and Tampermonkey responses. See the [userscript verification record](docs/verification/userscript-verification.md) for automated results and the pending browser checks.

## Scribe engine bench

The bench is a development page for judging the scribe engine against a real exported campaign. It is not the scribe that will sit beside the chat. It builds the book from the export, shows it, lets you rule on what the engine could not decide, and lets you audit a sample of facts against the messages they cite.

1. Copy an exported campaign into `scribe/private/` under a name beginning `campaign-` and ending `.json`, for example `scribe/private/campaign-harbour.json`.
2. Start the server from this directory with `node scribe/bench/serve.mjs`.
3. Open `http://localhost:8766/`.
4. Type your OpenRouter key, choose the campaign, check the model, the messages per stretch, the stop point and the budget, and press **Start**. **Continue the saved book** resumes a book saved earlier. **Pause** stops after the stretch in flight.

The tabs:

- **Progress** shows the model call in flight with its seconds, then one line per finished step with what was stored, refused and spent. A step that refused lines opens to list them.
- **Book** lists the subjects, searchable by name and other names, and shows one subject's facts with their source, status and who knows them. Facts are added, removed, made public and split off to a second person here.
- **Timeline** lists the scenes with their day, messages, place, reach and who was present.
- **Rulings** lists what the engine could not decide, the fuller statements, and the rulings already made, each of which can be revoked.
- **Audit** draws thirty facts beside the messages they cite, to be marked right or wrong and saved.

The OpenRouter key is typed into the page each session. The page sends it only in the request to OpenRouter and saves it nowhere. The browser may offer to save the key field as a password: decline it.

`scribe/private/` is ignored by Git. It holds the export, the saved book (`log-<room>.json`), one file per model call (`calls-<room>-<n>.json`, or `calls-<room>-unreadable-<time>.json` for an answer the engine could not read, where the time is in milliseconds) and the saved audits (`audit-<room>.json`).

Run the engine's tests with `node --test tests/scribe-*.test.mjs`. The [scribe engine verification record](docs/verification/scribe-engine-verification.md) lists what has and has not been checked.

## The scribe on the Zeta page

The scribe is a second userscript, separate from the notes widget above. It keeps a book of a campaign (people, facts, who knows what, scenes, open threads), reminds the scene what it knows with each message you send, checks each reply against the book, and offers developments. It stores everything in Tampermonkey's storage in this browser and talks to one outside service, OpenRouter, with your own key.

### Build and install

1. From this directory run `node scribe/pack.mjs`. It writes `scribe/scribe.user.js` from the sources under `scribe/core/` and `scribe/page/`. Run it again after any change to those files.
2. In the Tampermonkey dashboard create a new script, paste the contents of `scribe/scribe.user.js` and save. Its name is **Zeta Scribe**.
3. **Disable the old Zeta DM Memory script** while the scribe is enabled. Both hold Enter back and write into the message box; together they append twice.
4. When Tampermonkey asks for a connection, allow only `openrouter.ai`.
5. Open a Zeta room. The panel appears at the right edge; under 1,100 px of window width it starts collapsed behind a **Scribe** button.

### First evening

1. **Progress** tab, *Key and settings*: paste your OpenRouter key and press **Save key**. The key is kept in Tampermonkey's storage and sent only in the request to OpenRouter. Decline the browser's offer to save it as a password.
2. Check the three models, the messages per stretch (40), the sends between reminders (6) and the day's budget in dollars (3), then press **Adopt this chat**. The scribe pulls the whole chat with the page's own login, then reads it stretch by stretch. A long chat takes a while and costs most of what the scribe will ever cost for it. **Pause** stops after the stretch in flight; **Resume** goes on.
3. **Rulings** tab: rule what the engine could not decide (conflicts, look-alikes, questions). Your rulings outrank the story and survive every later reading.
4. Play. From then on the scribe works at the newest message.

### What it does while you play

- **With your next message.** When you press Enter, one line beginning `@: [Scribe]` is added under your text: the day, the place, who is present, and what those present know. Texts from the book stand in quotation marks; people the book does not know are counted, not named. The **Findings** tab shows the line before it goes. If you touch the message box again, or the site refuses the send, the line is taken out again.
- **Findings.** Each new reply is checked for a misspelt name, a contradiction with the book, or a character using a secret they were never told. The scribe only reports. A contradicted fact goes first in the next reminder when everyone present may hear it. **Rule it...** puts the reply's value into the Tell box if the reply is right and the book wrong; **They were told** records that the speaker now knows; **Dismiss** drops the finding. The scribe never writes a correction into the chat.
- **A development.** **Suggest one** asks for a narrator line that brings an open thread back. Nothing is sent unless you press **Use**; it then goes with your next message.
- **Tell the scribe.** Write what the book should know. **Work it out** shows what would change in the book; **File it** files exactly that. Nothing typed here is sent to the chat.
- **Regenerated and edited replies.** Findings about a reply that was regenerated, edited or deleted go away, and the new text is checked. An edit to an old message is noticed at the next whole pull (**Pull the chat again**), and only its stretch is read again.

The other tabs: **Summary** (what needs you, the cast, where the story stands), **Book** (every subject with its facts; add, remove, make public, split), **Timeline** (scenes by day), **Progress** (readings, the last model calls, how the last pull ended, **Export**, **Start the book over**).

### Money

Every answer OpenRouter bills is counted against the day's budget, including answers that came back empty or cut off. When the budget is reached, reading stops and replies are no longer checked until the next day. The header shows the day's spending.

### One tab reads

The tab you are looking at reads and checks. A second tab on the same chat shows the book and changes nothing. A hidden tab does nothing until it is shown again.

### Limits

- Nothing here has run in a real browser or against the real site or a real model yet. The [scribe page verification record](docs/verification/scribe-page-verification.md) lists what the tests cover and, in order, what to check on the real page first.
- The book runs up to one stretch behind the newest message. Until a stretch is read, reminders carry lasting facts and who knows what, not locations or passing conditions.
- A reminder is left out of a message when the book, the scene or the findings changed after it was prepared; the next message carries a fresh one.
- Deleting the opening messages of a chat on the site is not noticed. Use **Start the book over**.
- Names in scripts without capital letters, and names with unusual characters, are counted among "others" in the reminder.
- If the userscript runs in the page's own JavaScript world, a hostile script on the site could observe the key. The scribe assumes Zeta's own scripts are not hostile.
- `scribe/private/` and `spike/` hold exports and are ignored by Git, but a web server that serves this directory would serve them.

Run the tests one file at a time, for example `node --test tests/scribe-whole.test.mjs`. On a machine with little memory use `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 <file>`.

## Limits and provenance

This is a single-owner API for the Free plan. Accepted requests write the rate counter before the room operation. Platform quota exhaustion can interrupt service, including with Cloudflare-generated responses outside the API error format. Each room stores its current notes only. Provider-managed backups are separate from application history. No plan upgrades are automated.

The Worker, schema, and fixtures were authored for this project. Test notes and endpoints are fictional. The package uses no image assets or third-party runtime packages. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing and quotas](https://developers.cloudflare.com/d1/platform/pricing/).
