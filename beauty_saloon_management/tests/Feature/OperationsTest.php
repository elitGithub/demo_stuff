<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Stylist;
use App\Models\User;
use App\Services\BillingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class OperationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_reports_use_local_paid_date_currency_and_quantities(): void
    {
        config(['studio.timezone' => 'Asia/Jerusalem', 'studio.currency' => 'USD']);
        $billing = app(BillingService::class);
        $client = Client::create(['name' => '=HYPERLINK("bad")']);
        foreach (['2026-10-14 20:59:59', '2026-10-14 21:00:00', '2026-10-15 20:59:59', '2026-10-15 21:00:00'] as $i => $time) {
            $invoice = $billing->issueStandalone($client, [['name' => 'Shampoo', 'price' => 1000, 'quantity' => 2]], 'retail', 'report-'.$i);
            $billing->pay($invoice, 'cash');
            $invoice->update(['paid_at' => $time]);
        }
        $this->actingAs(User::factory()->create())->get('/app/reports?from=2026-10-15&to=2026-10-15&currency=USD')
            ->assertOk()->assertViewHas('totals', fn ($totals) => (int) $totals->total === 4000 && (int) $totals->sales === 2)
            ->assertViewHas('items', fn ($items) => (int) $items->first()->quantity === 4);
        $export = $this->get('/app/reports/export?from=2026-10-15&to=2026-10-15&currency=USD')->assertOk()->streamedContent();
        $this->assertStringContainsString("'=HYPERLINK", $export);
    }

    public function test_reports_reject_invalid_ranges_and_staff_access(): void
    {
        $this->actingAs(User::factory()->create())->get('/app/reports?from=2026-10-16&to=2026-10-15')->assertSessionHasErrors('to');
        $this->actingAs(User::factory()->create(['role' => 'staff']))->get('/app/reports/export')->assertForbidden();
    }

    public function test_owner_can_create_staff_with_a_hashed_password_and_manager(): void
    {
        $owner = User::factory()->create(['role' => 'owner']);
        $this->actingAs($owner)->post('/app/access', ['name' => 'Team member', 'email' => 'new@example.test', 'role' => 'staff', 'manager_id' => $owner->id, 'active' => 1, 'password' => 'LongPassphrase123!', 'password_confirmation' => 'LongPassphrase123!'])->assertSessionHasNoErrors();
        $user = User::where('email', 'new@example.test')->firstOrFail();
        $this->assertTrue(Hash::check('LongPassphrase123!', $user->password));
        $this->assertSame($owner->id, $user->manager_id);
    }

    public function test_profile_password_change_requires_current_password_and_does_not_accept_role(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        $data = ['name' => 'Updated', 'email' => $user->email, 'role' => 'owner', 'password' => 'NewPassphrase123!', 'password_confirmation' => 'NewPassphrase123!', 'current_password' => 'wrong'];
        $this->actingAs($user)->put('/app/profile', $data)->assertSessionHasErrors('current_password');
        $data['current_password'] = 'password';
        $this->put('/app/profile', $data)->assertSessionHasNoErrors();
        $this->assertSame('staff', $user->fresh()->role);
        $this->assertTrue(Hash::check('NewPassphrase123!', $user->fresh()->password));
    }

    public function test_commission_report_keeps_stylists_with_the_same_name_separate(): void
    {
        $client = Client::create(['name' => 'Client']);
        foreach ([10, 20] as $rate) {
            $stylist = Stylist::create(['name' => 'Alex Smith', 'title' => 'Stylist', 'commission_rate' => $rate]);
            $invoice = app(BillingService::class)->issueStandalone($client, [['name' => 'Item', 'price' => 1000, 'quantity' => 1]], 'retail', 'stylist-'.$rate);
            $invoice->update(['kind' => 'service', 'stylist_id' => $stylist->id, 'stylist_name' => $stylist->name, 'commission_rate' => $rate, 'commission_amount' => $rate * 10]);
            app(BillingService::class)->pay($invoice, 'cash');
        }
        $this->actingAs(User::factory()->create())->get('/app/reports')->assertOk()
            ->assertViewHas('team', fn ($team) => $team->count() === 2 && $team->pluck('commission')->sort()->values()->all() === [100, 200]);
    }
}
