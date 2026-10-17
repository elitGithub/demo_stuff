<?php

namespace Tests\Feature;

use App\Models\User;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ForRealPageTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    public function test_the_authenticated_page_has_exactly_the_five_sections_in_order_without_a_layout_cookie(): void
    {
        $response = $this->actingAs(User::factory()->create())->get(route('for-real'))->assertOk()->assertViewIs('for-real');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $headings = [];
        foreach ($document->querySelectorAll('main h2') as $heading) {
            $headings[] = $heading->textContent;
        }

        $this->assertSame([
            'What this demo fakes',
            'How a real connection works',
            'Three ways to run it',
            'What it costs each month',
            'What changes in this code',
        ], $headings);
        $this->assertNotNull($document->querySelector('.app-nav a[aria-current="page"][data-pending][href="'.route('for-real').'"]'));
    }

    /**
     * @return void
     */
    public function test_each_option_has_the_promised_rows_and_only_the_bridge_is_recommended(): void
    {
        $response = $this->actingAs(User::factory()->create())->get('/how-it-runs')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertCount(3, $document->querySelectorAll('.connection-option'));
        $this->assertCount(1, $document->querySelectorAll('[data-recommended]'));
        $this->assertSame('This app plus a small Apps Script bridge', $document->querySelector('[data-recommended] h3')->textContent);
        $this->assertStringContainsString('Recommended for a private personal inbox', $document->querySelector('[data-recommended]')->textContent);
        foreach ($document->querySelectorAll('.connection-option') as $option) {
            $labels = [];
            foreach ($option->querySelectorAll('dt') as $label) {
                $labels[] = $label->textContent;
            }
            $this->assertSame(['Who it suits', 'What it costs', 'The catch'], $labels);
        }
    }

    /**
     * @return void
     */
    public function test_cost_rows_have_current_markers_and_google_copy_preserves_the_review_caveats(): void
    {
        $response = $this->actingAs(User::factory()->create())->get('/how-it-runs')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $rows = $document->querySelectorAll('.cost-table tbody tr');
        $this->assertCount(5, $rows);
        $labels = [];
        foreach ($rows as $row) {
            $labels[] = $row->querySelector('th[scope="row"]')->textContent;
            $this->assertStringContainsString('(checked October 2026)', $row->querySelector('td')->textContent);
        }
        $this->assertSame(['Google services', 'Shared PHP hosting', 'Small virtual server', 'Domain', 'InfinityFree'], $labels);
        $this->assertGreaterThanOrEqual(5, substr_count($response->getContent(), 'checked October 2026'));
        $response->assertSee('Personal-use apps can be exempt from review.')
            ->assertSee('A bridge does not automatically exempt a service offered to other people')
            ->assertSee('An unverified app is not necessarily stuck in Testing.')
            ->assertSee('Assessment prices depend on the provider')
            ->assertSee('switching the setting alone will not connect a mailbox.')
            ->assertDontSee('no yearly assessment')
            ->assertDontSee('few hundred dollars');
        foreach ($document->querySelectorAll('main a') as $source) {
            $this->assertSame('https', parse_url($source->getAttribute('href'), PHP_URL_SCHEME));
            $this->assertContains(parse_url($source->getAttribute('href'), PHP_URL_HOST), [
                'developers.google.com', 'support.google.com', 'www.hostinger.com', 'docs.hetzner.com', 'www.infinityfree.com',
            ]);
            $this->assertSame('noopener', $source->getAttribute('rel'));
        }
    }

    /**
     * @return void
     */
    public function test_a_guest_cannot_open_the_page(): void
    {
        $this->get('/how-it-runs')->assertRedirect(route('sign-in'));
    }
}
