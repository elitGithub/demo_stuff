# Zeta DM notes API

Private per-room notes storage for the Zeta AI Tampermonkey script. This package includes the installable userscript, Cloudflare Worker, and D1 schema. The injection interval, turn counter, inject-next flag, and collapsed state stay in each browser.

## Install or update the userscript

1. Open [zeta-dm-memory.user.js](zeta-dm-memory.user.js). In the Tampermonkey dashboard, replace the contents of the existing script with this version and save. The name and namespace match v1.2. Keep one enabled copy.
2. When Tampermonkey prompts for a connection, allow only the Worker host listed in the script, `zeta-dm-memory.elit1989.workers.dev`.
3. On Zeta AI, select **Set DM API key** from the Tampermonkey menu and enter your Worker key. Repeat in each browser. The native prompt shows the key as you type. Keep it out of screenshots.
4. Reload a Zeta room. The widget reads cloud notes for its exact pathname. Without a key, the widget keeps working with browser-local notes.

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
& 'C:/Program Files/nodejs/node.exe' --test tests/userscript.test.mjs
```

The userscript tests run the installed source in a Node VM with controlled browser events, time, and Tampermonkey responses. See the [userscript verification record](docs/verification/userscript-verification.md) for automated results and the pending browser checks.

## Limits and provenance

This is a single-owner API for the Free plan. Accepted requests write the rate counter before the room operation. Platform quota exhaustion can interrupt service, including with Cloudflare-generated responses outside the API error format. Each room stores its current notes only. Provider-managed backups are separate from application history. No plan upgrades are automated.

The Worker, schema, and fixtures were authored for this project. Test notes and endpoints are fictional. The package uses no image assets or third-party runtime packages. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing and quotas](https://developers.cloudflare.com/d1/platform/pricing/).
