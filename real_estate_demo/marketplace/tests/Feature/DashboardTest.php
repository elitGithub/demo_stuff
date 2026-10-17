<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_customer_dashboard_only_counts_and_displays_own_records(): void
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $job = $this->job($customer, $category, ['title' => 'My kitchen project']);
        $this->quote($job, $provider);
        $this->job($customer, $category, ['status' => 'completed']);
        $other = $this->job($this->customer(), $category, ['title' => 'Private other project']);
        $this->quote($other, $provider);
        $this->actingAs($customer)->get('/dashboard')->assertOk()->assertSee('My kitchen project')->assertDontSee('Private other project')
            ->assertViewHas('stats', ['Open requests' => 1, 'New proposals' => 1, 'In good hands' => 0, 'All done' => 1]);
    }

    public function test_provider_metrics_and_simulated_totals_only_count_their_work(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category);
        $other = $this->provider($category);
        foreach ([[$provider, 12000], [$other, 99000]] as [$worker, $amount]) {
            $job = $this->job($this->customer(), $category, ['status' => 'completed']);
            $quote = $this->quote($job, $worker, ['status' => 'accepted', 'amount_cents' => $amount]);
            $job->update(['accepted_quote_id' => $quote->id]);
            $job->payment()->create(['customer_id' => $job->customer_id, 'receipt_number' => (string) Str::uuid(), 'amount_cents' => $amount, 'currency' => 'USD', 'status' => 'simulated_paid', 'paid_at' => now()]);
        }
        $this->job($this->customer(), $category);
        $this->job($this->customer(), $category, ['service_area' => 'Cedar Park']);
        $this->actingAs($provider)->get('/dashboard')->assertOk()->assertViewHas('simulatedTotal', 12000)
            ->assertViewHas('stats', ['Opportunities' => 1, 'Proposals sent' => 0, 'Active jobs' => 0, 'Completed' => 1])
            ->assertSee('Simulated payments')->assertSee('$120.00')->assertDontSee('$990.00');
    }

    public function test_admin_overview_and_filters_are_derived_from_persisted_records(): void
    {
        $category = Category::factory()->create();
        Category::factory()->create(['is_active' => false]);
        $this->provider($category, status: 'pending');
        $approved = $this->provider($category);
        $this->job($this->customer(), $category, ['title' => 'Open fence project']);
        $completed = $this->job($this->customer(), $category, ['status' => 'completed', 'title' => 'Finished kitchen']);
        $quote = $this->quote($completed, $approved, ['status' => 'accepted']);
        $completed->update(['accepted_quote_id' => $quote->id]);
        $completed->payment()->create(['customer_id' => $completed->customer_id, 'receipt_number' => (string) Str::uuid(), 'amount_cents' => 18550, 'currency' => 'USD', 'status' => 'simulated_paid', 'paid_at' => now()]);
        $this->actingAs(User::factory()->admin()->create())->get('/admin')->assertOk()
            ->assertViewHas('stats', ['Requests' => 2, 'Pending professionals' => 1, 'Active services' => 1, 'Completed jobs' => 1])
            ->assertViewHas('simulatedTotal', 18550)->assertSee('$185.50');
        $this->get('/dashboard')->assertOk()->assertSee('Marketplace overview');
        $this->get('/admin/jobs?status=open')->assertOk()->assertSee('Open fence project')->assertDontSee('Finished kitchen');
        $this->get('/admin/providers?status=pending')->assertOk()->assertDontSee($approved->profile->business_name);
        $this->get("/conversations/{$quote->id}")->assertForbidden();
    }
}
