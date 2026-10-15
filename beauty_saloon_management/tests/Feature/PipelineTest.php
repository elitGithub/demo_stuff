<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Opportunity;
use App\Models\User;
use App\Services\BillingService;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\CarbonImmutable;
use Database\Seeders\PipelineSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PipelineTest extends TestCase
{
    use RefreshDatabase;

    public function test_pipeline_and_export_require_authentication(): void
    {
        $this->get('/app/pipeline')->assertRedirect('/login');
        $this->get('/app/pipeline/export')->assertRedirect('/login');
        $this->post('/app/pipeline', [])->assertRedirect('/login');
        $this->get('/app/pipeline/1')->assertRedirect('/login');
        $this->put('/app/pipeline/1', [])->assertRedirect('/login');
        $this->post('/app/pipeline/1/transition', [])->assertRedirect('/login');
        $this->post('/app/pipeline/1/reopen', [])->assertRedirect('/login');
        $this->post('/app/pipeline/1/documents', [])->assertRedirect('/login');
        $this->get('/app/pipeline/1/documents/1')->assertRedirect('/login');
    }

    public function test_staff_only_see_and_change_their_assigned_enquiries(): void
    {
        $staff = User::factory()->create(['role' => 'staff', 'active' => true]);
        $own = Opportunity::factory()->create(['assigned_to' => $staff->id, 'title' => 'Own bridal package']);
        $other = Opportunity::factory()->create(['title' => 'Private company booking']);
        $this->actingAs($staff)->get('/app/pipeline')->assertOk()->assertSee('Own bridal package')->assertDontSee('Private company booking');
        $this->get('/app/pipeline/'.$own->id)->assertOk();
        $this->get('/app/pipeline/'.$other->id)->assertNotFound();
        $this->put('/app/pipeline/'.$other->id, ['title' => 'Taken over'])->assertNotFound();
        $this->post('/app/pipeline/'.$other->id.'/transition', $this->step('engagement'))->assertNotFound();
        $this->put('/app/pipeline/'.$own->id, $this->details($own) + ['assigned_to' => $other->assigned_to])->assertForbidden();
        $this->assertSame($staff->id, $own->fresh()->assigned_to);
    }

    public function test_manager_can_assign_active_users_and_staff_creation_is_self_assigned(): void
    {
        $manager = User::factory()->create(['role' => 'manager', 'active' => true]);
        $agent = User::factory()->create(['role' => 'staff', 'active' => true]);
        $inactive = User::factory()->create(['role' => 'staff', 'active' => false]);
        $client = Client::create(['name' => 'Wedding client']);
        $data = ['client_id' => $client->id, 'title' => 'Wedding party', 'kind' => 'group_booking', 'guest_count' => 6, 'next_action' => 'Call organiser', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')];
        $this->actingAs($manager)->post('/app/pipeline', $data + ['assigned_to' => $inactive->id])->assertSessionHasErrors('assigned_to');
        $this->post('/app/pipeline', $data + ['assigned_to' => $agent->id])->assertSessionHasNoErrors()->assertRedirect();
        $opportunity = Opportunity::firstOrFail();
        $this->assertSame($agent->id, $opportunity->assigned_to);
        $this->assertSame('lead', $opportunity->stage);
        $this->assertSame('created', $opportunity->events()->first()->type);
        $this->actingAs($agent)->post('/app/pipeline', $data + ['assigned_to' => $manager->id])->assertForbidden();
        $this->post('/app/pipeline', $data)->assertSessionHasNoErrors()->assertRedirect();
        $this->assertSame($agent->id, Opportunity::latest('id')->first()->assigned_to);
    }

    public function test_stage_sequence_preserves_references_dates_and_append_only_history(): void
    {
        $this->freezeTime();
        $opportunity = Opportunity::factory()->create();
        $this->actingAs($opportunity->assignedUser);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('order'))->assertSessionHasErrors('stage');
        $this->assertSame('lead', $opportunity->fresh()->stage);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('engagement'))->assertSessionHasNoErrors();
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('proposal', ['reference' => '']))->assertSessionHasErrors('reference');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('proposal', ['reference' => 'QTN-42', 'remarks' => 'Six guests, hair and makeup']))->assertSessionHasNoErrors();
        $this->assertSame('QTN-42', $opportunity->fresh()->stage_details['proposal']['reference']);
        $this->assertSame(now()->toDateString(), $opportunity->fresh()->stage_details['proposal']['occurred_on']);
        $this->assertSame(2, $opportunity->events()->count());
        $event = $opportunity->events()->first();
        $this->expectException(\LogicException::class);
        $event->update(['remarks' => 'Rewrite history']);
    }

    public function test_cancelled_enquiries_require_reason_and_manager_reopen_is_explicit(): void
    {
        $opportunity = Opportunity::factory()->create();
        $this->actingAs($opportunity->assignedUser);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('cancelled'))->assertSessionHasErrors('reason');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('cancelled', ['reason' => 'Event postponed']))->assertSessionHasNoErrors();
        $this->assertSame('cancelled', $opportunity->fresh()->stage);
        $this->assertNull($opportunity->fresh()->next_follow_up_at);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('closed'))->assertSessionHasErrors('stage');
        $this->put('/app/pipeline/'.$opportunity->id, $this->details($opportunity))->assertSessionHasErrors('stage');
        $this->post('/app/pipeline/'.$opportunity->id.'/reopen', ['reason' => 'New event date'])->assertForbidden();
        $this->actingAs(User::factory()->create(['role' => 'manager', 'active' => true]));
        $this->post('/app/pipeline/'.$opportunity->id.'/reopen', ['reason' => ''])->assertSessionHasErrors('reason');
        $this->post('/app/pipeline/'.$opportunity->id.'/reopen', ['reason' => 'New event date', 'next_action' => 'Confirm new date', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')])->assertSessionHasNoErrors();
        $this->assertSame('lead', $opportunity->fresh()->stage);
        $this->assertSame(['cancelled', 'reopened'], $opportunity->events()->orderBy('id')->pluck('type')->all());
        $this->assertSame('Event postponed', $opportunity->events()->first()->remarks);
    }

    public function test_closing_requires_a_paid_linked_invoice_for_the_same_client(): void
    {
        $opportunity = Opportunity::factory()->create(['stage' => 'delivery']);
        $other = Client::create(['name' => 'Other client']);
        $billing = app(BillingService::class);
        $unpaid = $billing->issueStandalone($opportunity->client, [['name' => 'Event kit', 'price' => 5000, 'quantity' => 1]], 'retail', 'pipeline-own-invoice');
        $wrong = $billing->issueStandalone($other, [['name' => 'Another kit', 'price' => 5000, 'quantity' => 1]], 'retail', 'pipeline-other-invoice');
        $billing->pay($wrong, 'cash');
        $this->actingAs($opportunity->assignedUser);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('closed'))->assertSessionHasErrors('invoice_id');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('closed', ['invoice_id' => $wrong->id]))->assertSessionHasErrors('invoice_id');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('closed', ['invoice_id' => $unpaid->id]))->assertSessionHasErrors('invoice_id');
        $this->assertSame('delivery', $opportunity->fresh()->stage);
        $this->assertSame(0, $opportunity->events()->count());
        $billing->pay($unpaid, 'cash');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('closed', ['invoice_id' => $unpaid->id]))->assertSessionHasNoErrors();
        $this->assertSame('closed', $opportunity->fresh()->stage);
        $this->assertSame($unpaid->id, $opportunity->fresh()->invoice_id);
        $this->get('/app/pipeline/'.$opportunity->id)->assertOk()->assertSee($unpaid->number);
        $manager = User::factory()->create(['role' => 'manager', 'active' => true]);
        $this->actingAs($manager)->post('/app/pipeline/'.$opportunity->id.'/reopen', ['reason' => 'Additional package requested', 'next_action' => 'Discuss the new request', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')])->assertSessionHasNoErrors();
        $reopened = $opportunity->events()->where('type', 'reopened')->firstOrFail();
        $this->assertSame($unpaid->id, $reopened->details['previous_cycle']['invoice_id']);
        $this->assertSame('REF-12', $reopened->details['previous_cycle']['stage_details']['closed']['reference']);
        $this->assertNull($opportunity->fresh()->invoice_id);
        $this->assertSame('paid', $unpaid->fresh()->status);
    }

    public function test_documents_are_validated_private_and_downloads_follow_assignment_scope(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        $opportunity = Opportunity::factory()->create();
        $other = Opportunity::factory()->create();
        $this->actingAs($opportunity->assignedUser);
        $base = '/app/pipeline/'.$opportunity->id.'/documents';
        $this->post($base, ['document' => UploadedFile::fake()->createWithContent('script.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')])->assertSessionHasErrors('document');
        $this->post($base, ['document' => UploadedFile::fake()->createWithContent('fake.pdf', '<?php echo "unsafe";')])->assertSessionHasErrors('document');
        $this->post($base, ['document' => UploadedFile::fake()->create('too-big.pdf', 6000, 'application/pdf')])->assertSessionHasErrors('document');
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e0AAAAASUVORK5CYII=');
        $this->post($base, ['document' => UploadedFile::fake()->createWithContent('reference.php', $png)])->assertSessionHasErrors('document');
        $this->post($base, ['document' => UploadedFile::fake()->createWithContent('reference.png', $png), 'label' => 'Style reference'])->assertSessionHasNoErrors();
        $document = $opportunity->documents()->firstOrFail();
        Storage::disk('local')->assertExists($document->path);
        Storage::disk('public')->assertMissing($document->path);
        $this->get($base.'/'.$document->id)->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('Content-Disposition', 'attachment; filename=reference.png');
        $this->get('/app/pipeline/'.$other->id.'/documents/'.$document->id)->assertNotFound();
        $this->actingAs($other->assignedUser)->get($base.'/'.$document->id)->assertNotFound();
        $this->actingAs(User::factory()->create(['role' => 'manager', 'active' => true]))->get($base.'/'.$document->id)->assertOk();
    }

    public function test_valid_pdf_can_be_uploaded_and_downloaded_as_an_attachment(): void
    {
        Storage::fake('local');
        $opportunity = Opportunity::factory()->create();
        $pdf = Pdf::loadHTML('<p>Signed quotation</p>')->output();
        $this->actingAs($opportunity->assignedUser)->post('/app/pipeline/'.$opportunity->id.'/documents', ['document' => UploadedFile::fake()->createWithContent('quotation.pdf', $pdf), 'label' => 'Signed quotation'])->assertSessionHasNoErrors();
        $document = $opportunity->documents()->firstOrFail();
        $response = $this->get('/app/pipeline/'.$opportunity->id.'/documents/'.$document->id)->assertOk()->assertHeader('Content-Type', 'application/pdf')->assertHeader('Content-Disposition', 'attachment; filename=quotation.pdf');
        $this->assertSame($pdf, $response->streamedContent());
        $this->assertDatabaseHas('opportunity_events', ['opportunity_id' => $opportunity->id, 'type' => 'document_added']);
    }

    public function test_details_cannot_change_client_stage_or_history_and_html_is_escaped(): void
    {
        $opportunity = Opportunity::factory()->create();
        $other = Opportunity::factory()->create();
        $title = '<script>alert("unsafe")</script>';
        $data = array_replace($this->details($opportunity), ['title' => $title, 'client_id' => $other->client_id, 'stage' => 'closed', 'created_by' => $other->assigned_to, 'stage_details' => ['closed' => ['reference' => 'FORGED']], 'notes' => '<img src=x onerror=alert(1)>']);
        $this->actingAs($opportunity->assignedUser)->put('/app/pipeline/'.$opportunity->id, $data)->assertSessionHasNoErrors();
        $fresh = $opportunity->fresh();
        $this->assertSame($title, $fresh->title);
        $this->assertSame($opportunity->client_id, $fresh->client_id);
        $this->assertSame('lead', $fresh->stage);
        $this->assertSame($opportunity->stage_details, $fresh->stage_details);
        $this->assertSame($opportunity->created_by, $fresh->created_by);
        $this->get('/app/pipeline/'.$opportunity->id)->assertOk()->assertSee($title)->assertDontSee($title, false)->assertDontSee('<img src=x onerror=alert(1)>', false);
        $this->assertSame('updated', $fresh->events()->first()->type);
    }

    public function test_manager_can_reopen_with_an_active_assignee_after_the_original_assignee_is_disabled(): void
    {
        $opportunity = Opportunity::factory()->create(['stage' => 'cancelled']);
        $opportunity->assignedUser->update(['active' => false]);
        $manager = User::factory()->create(['role' => 'manager', 'active' => true]);
        $newAgent = User::factory()->create(['role' => 'staff', 'active' => true]);
        $this->actingAs($manager)->post('/app/pipeline/'.$opportunity->id.'/reopen', ['assigned_to' => $newAgent->id, 'reason' => 'Client confirmed new plans', 'next_action' => 'New organiser call', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')])->assertSessionHasNoErrors();
        $this->assertSame($newAgent->id, $opportunity->fresh()->assigned_to);
        $this->assertSame('lead', $opportunity->fresh()->stage);
        $this->assertSame($opportunity->assigned_to, $opportunity->events()->first()->details['previous_cycle']['assigned_to']);
    }

    public function test_stage_dates_must_be_chronological_and_cannot_be_in_the_future(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-15 12:00:00 UTC'));
        $opportunity = Opportunity::factory()->create(['stage_details' => ['lead' => ['occurred_on' => '2026-10-14']]]);
        $this->actingAs($opportunity->assignedUser);
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('engagement', ['occurred_on' => '2026-10-13']))->assertSessionHasErrors('occurred_on');
        $this->post('/app/pipeline/'.$opportunity->id.'/transition', $this->step('engagement', ['occurred_on' => '2026-10-16']))->assertSessionHasErrors('occurred_on');
        $this->assertSame('lead', $opportunity->fresh()->stage);
        $this->assertSame(0, $opportunity->events()->count());
    }

    public function test_export_stage_date_filters_include_the_whole_local_day_and_allow_an_end_date_alone(): void
    {
        config(['studio.timezone' => 'Asia/Jerusalem']);
        $agent = User::factory()->create(['role' => 'staff', 'active' => true]);
        foreach (['Before day' => '2026-10-14 20:59:59', 'Start of day' => '2026-10-14 21:00:00', 'End of day' => '2026-10-15 20:59:59', 'After day' => '2026-10-15 21:00:00'] as $title => $date) {
            Opportunity::factory()->create(['assigned_to' => $agent->id, 'title' => $title, 'stage_entered_at' => $date]);
        }
        $this->actingAs($agent);
        $csv = $this->get('/app/pipeline/export?from=2026-10-15&to=2026-10-15')->assertOk()->streamedContent();
        $this->assertStringContainsString('Start of day', $csv);
        $this->assertStringContainsString('End of day', $csv);
        $this->assertStringNotContainsString('Before day', $csv);
        $this->assertStringNotContainsString('After day', $csv);
        $csv = $this->get('/app/pipeline/export?to=2026-10-15')->assertOk()->streamedContent();
        $this->assertStringContainsString('Before day', $csv);
        $this->assertStringNotContainsString('After day', $csv);
    }

    public function test_export_uses_assignment_scope_filters_and_neutralises_formula_prefixes(): void
    {
        $opportunity = Opportunity::factory()->create(['title' => '=HYPERLINK("evil")', 'next_action' => "\t+CMD", 'stage' => 'proposal']);
        $opportunity->client->update(['name' => '@SUM(1+1)', 'company' => '  -ACME', 'segment' => 'b2b']);
        Opportunity::factory()->create(['title' => 'Unassigned secret', 'stage' => 'proposal']);
        Opportunity::factory()->create(['assigned_to' => $opportunity->assigned_to, 'title' => 'Different stage', 'stage' => 'lead']);
        $this->actingAs($opportunity->assignedUser);
        $response = $this->get('/app/pipeline/export?stage=proposal&segment=b2b')->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $csv = $response->streamedContent();
        $this->assertStringContainsString("'=HYPERLINK", $csv);
        $this->assertStringContainsString("'@SUM(1+1)", $csv);
        $this->assertStringContainsString("'  -ACME", $csv);
        $this->assertStringContainsString("'\t+CMD", $csv);
        $this->assertStringNotContainsString('Unassigned secret', $csv);
        $this->assertStringNotContainsString('Different stage', $csv);
    }

    public function test_pipeline_seeder_is_demo_only_and_idempotent(): void
    {
        config(['studio.demo' => false]);
        $this->seed(PipelineSeeder::class);
        $this->assertDatabaseCount('opportunities', 0);
        config(['studio.demo' => true]);
        User::factory()->create(['role' => 'owner', 'active' => true]);
        $this->seed(PipelineSeeder::class);
        $count = Opportunity::count();
        $this->assertGreaterThanOrEqual(3, $count);
        $this->seed(PipelineSeeder::class);
        $this->assertSame($count, Opportunity::count());
        $this->actingAs(User::first())->get('/app/pipeline/create')->assertOk();
        foreach (Opportunity::all() as $opportunity) {
            $this->get('/app/pipeline/'.$opportunity->id)->assertOk();
        }
    }

    private function step(string $stage, array $overrides = []): array
    {
        return array_replace(['stage' => $stage, 'occurred_on' => now()->toDateString(), 'reference' => 'REF-12', 'remarks' => 'Confirmed with client', 'next_action' => 'Follow up', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')], $overrides);
    }

    private function details(Opportunity $opportunity): array
    {
        return ['title' => $opportunity->title, 'kind' => $opportunity->kind, 'guest_count' => 1, 'next_action' => 'Call client', 'next_follow_up_at' => now()->addDay()->format('Y-m-d\TH:i')];
    }
}
