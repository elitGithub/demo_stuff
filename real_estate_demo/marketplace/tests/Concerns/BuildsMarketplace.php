<?php

namespace Tests\Concerns;

use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;

trait BuildsMarketplace
{
    protected function customer(): User
    {
        return User::factory()->customer()->create();
    }

    protected function provider(Category $category, string $area = 'Austin', string $status = 'approved'): User
    {
        $user = User::factory()->provider()->create();
        $profile = ProviderProfile::factory()->create([
            'user_id' => $user->id, 'service_areas' => [$area], 'status' => $status,
        ]);
        $profile->categories()->attach($category);

        return $user;
    }

    protected function job(User $customer, Category $category, array $attributes = []): ServiceRequest
    {
        return ServiceRequest::factory()->create(array_merge([
            'customer_id' => $customer->id, 'category_id' => $category->id,
            'service_area' => 'Austin', 'street_address' => '1842 Juniper Lane', 'status' => 'open',
        ], $attributes));
    }

    protected function quote(ServiceRequest $job, User $provider, array $attributes = []): Quote
    {
        return Quote::factory()->create(array_merge([
            'service_request_id' => $job->id, 'provider_id' => $provider->id,
            'amount_cents' => 18550, 'status' => 'pending',
        ], $attributes));
    }
}
