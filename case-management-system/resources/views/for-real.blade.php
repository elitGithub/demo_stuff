<x-app-layout title="How this runs for real">
    <article class="for-real-page">
        <header>
            <p class="eyebrow">From demonstration to your inbox</p>
            <h1>How this runs for real</h1>
            <p class="muted">The screens work today. Connecting your own mailbox is a separate piece of work.</p>
        </header>

        <section class="surface for-real-section" aria-labelledby="demo-fakes">
            <h2 id="demo-fakes">What this demo fakes</h2>
            <p>The Google sign-in button signs you in as a fictional landlord without contacting Google. The inbox, incoming mail and sent replies are simulated; no real email is read or sent. Hosted demo visitors get a private working copy that they can reset.</p>
        </section>

        <section class="surface for-real-section" aria-labelledby="real-connection">
            <h2 id="real-connection">How a real connection works</h2>
            <p>You sign in with Google and give permission to read mail and send replies. Casefile then checks for mail from your chosen senders, opens or updates their cases, and sends your replies through your mailbox.</p>
            <p>Checking every few minutes is the simpler starting point for a personal inbox. Google can also notify a connected service when mail changes. Permission may need renewing; publishing an app and having its permissions reviewed are separate steps.</p>
            <p class="for-real-source">Source: <a href="https://support.google.com/cloud/answer/15549945" target="_blank" rel="noopener">Google account access and publishing</a>.</p>
        </section>

        <section aria-labelledby="three-ways">
            <h2 id="three-ways">Three ways to run it</h2>
            <div class="connection-options">
                <article class="surface connection-option" aria-labelledby="sheet-option">
                    <h3 id="sheet-option">A Google Apps Script with a Google Sheet</h3>
                    <dl>
                        <div><dt>Who it suits</dt><dd>A person happy to manage their cases in a spreadsheet.</dd></div>
                        <div><dt>What it costs</dt><dd>USD 0 for the script and a personal Sheet (checked October 2026), within Google's account limits.</dd></div>
                        <div><dt>The catch</dt><dd>You get a Sheet rather than these screens. You still authorize the script, an unverified-app warning can appear, and Google's daily limits apply.</dd></div>
                    </dl>
                    <p class="for-real-source">Source: <a href="https://developers.google.com/apps-script/guides/client-verification" target="_blank" rel="noopener">Google's script authorization rules</a> and <a href="https://developers.google.com/apps-script/guides/services/quotas" target="_blank" rel="noopener">daily limits</a>.</p>
                </article>

                <article class="surface connection-option connection-recommended" aria-labelledby="bridge-option" data-recommended>
                    <p class="recommendation">Recommended for a private personal inbox</p>
                    <h3 id="bridge-option">This app plus a small Apps Script bridge</h3>
                    <dl>
                        <div><dt>Who it suits</dt><dd>An owner who wants these screens for their own mailbox.</dd></div>
                        <div><dt>What it costs</dt><dd>The app's hosting, plus an optional domain. The owner-run script has no added Google charge within its limits (checked October 2026).</dd></div>
                        <div><dt>The catch</dt><dd>The script needs building and authorization. It would aim to check every five minutes (checked October 2026), send selected mail to Casefile through a secured web connection, and send replies. Timing is not guaranteed. A bridge does not automatically exempt a service offered to other people from Google's review.</dd></div>
                    </dl>
                    <p class="for-real-source">Source: <a href="https://developers.google.com/apps-script/guides/client-verification" target="_blank" rel="noopener">Google's script review rules</a> and <a href="https://developers.google.com/apps-script/guides/services/quotas" target="_blank" rel="noopener">daily limits</a>.</p>
                </article>

                <article class="surface connection-option" aria-labelledby="direct-option">
                    <h3 id="direct-option">This app talking to Gmail directly</h3>
                    <dl>
                        <div><dt>Who it suits</dt><dd>A service intended to support more mailboxes, or an owner who wants a direct connection.</dd></div>
                        <div><dt>What it costs</dt><dd>Hosting and any review or security assessment needed for the way it is offered. Assessment prices depend on the provider; there is no universal fee.</dd></div>
                        <div><dt>The catch</dt><dd>Personal-use apps can be exempt from review. Apps left in Google's Testing state normally lose mail authorization after seven days (checked October 2026). Wider distribution with restricted mail data passing through a server can require verification and an annual security assessment. An unverified app is not necessarily stuck in Testing.</dd></div>
                    </dl>
                    <p class="for-real-source">Sources: <a href="https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification" target="_blank" rel="noopener">Google's review and personal-use exceptions</a>; <a href="https://support.google.com/cloud/answer/15549945" target="_blank" rel="noopener">Testing and Production states</a>.</p>
                </article>
            </div>
        </section>

        <section class="surface for-real-section" aria-labelledby="monthly-costs">
            <h2 id="monthly-costs">What it costs each month</h2>
            <p>Illustrative running costs for the recommended approach. Choose a hosting option; these are not charges to add together. Setup and ongoing support are separate work.</p>
            <table class="cost-table">
                <caption>Monthly running costs, checked October 2026</caption>
                <thead><tr><th scope="col">Item</th><th scope="col">Approximate cost</th><th scope="col">What to allow for</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Google services</th><td>USD 0 added charge (checked October 2026)</td><td>Standard Gmail API use currently has no added cost; account and script limits apply and pricing can change. <a href="https://developers.google.com/workspace/gmail/api/reference/quota" target="_blank" rel="noopener">Google limits and billing</a>.</td></tr>
                    <tr><th scope="row">Shared PHP hosting</th><td>About USD 3–11 (checked October 2026)</td><td>An illustrative Hostinger offer starts with a long prepaid term; renewal costs more. Tax and currency vary. <a href="https://www.hostinger.com/pricing" target="_blank" rel="noopener">Hostinger pricing</a>.</td></tr>
                    <tr><th scope="row">Small virtual server</th><td>About EUR 6 before tax (checked October 2026)</td><td>An illustrative Hetzner European server price; IPv4, tax and location can add cost. You also maintain the server. <a href="https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/" target="_blank" rel="noopener">Hetzner rates</a> and <a href="https://docs.hetzner.com/cloud/servers/primary-ips/overview/" target="_blank" rel="noopener">IP charges</a>.</td></tr>
                    <tr><th scope="row">Domain</th><td>Optional; variable (checked October 2026)</td><td>Depends on the extension, registrar and renewal rate. Check the renewal price before choosing.</td></tr>
                    <tr><th scope="row">InfinityFree</th><td>USD 0 for this demo (checked October 2026)</td><td>Fine for a demonstration. Daily account limits and web-only scheduling make it a poor fit for a real mailbox service. Confirm your account's limits and SQLite support before deployment. <a href="https://www.infinityfree.com/" target="_blank" rel="noopener">InfinityFree hosting</a>.</td></tr>
                </tbody>
            </table>
        </section>

        <section class="surface for-real-section" aria-labelledby="code-changes">
            <h2 id="code-changes">What changes in this code</h2>
            <p>The case workflow stays in the same app. A developer builds and configures the real Google sign-in provider and mailbox connector, replacing their simulated bindings, then changes <code>CASEFILE_MODE</code> to <code>production</code>. The live providers and bridge are not included in this demo; switching the setting alone will not connect a mailbox.</p>
            <p>Setup also includes your Google project and permissions, restricting sign-in to the owner's address, private credentials, secure hosting and scheduling, and the Google review steps that apply to your chosen approach. Production mode stops with an error when a real provider is missing.</p>
        </section>
    </article>
</x-app-layout>
