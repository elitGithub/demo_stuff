<?php

namespace Database\Factories;

use App\Enums\JobStatus;
use App\Models\Category;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ServiceRequest> */
class ServiceRequestFactory extends Factory
{
    public function definition(): array
    {
        return [
            'customer_id' => User::factory()->customer(),
            'category_id' => Category::factory(),
            'title' => 'A little help getting our home ready',
            'description' => 'Please help with a careful, thorough service for our home.',
            'service_area' => 'Austin',
            'street_address' => '1842 Juniper Lane',
            'preferred_date' => now('America/Chicago')->addDays(7)->toDateString(),
            'budget_cents' => 20000,
            'status' => JobStatus::Open,
        ];
    }
}
