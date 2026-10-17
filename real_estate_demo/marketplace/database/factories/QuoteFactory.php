<?php

namespace Database\Factories;

use App\Enums\QuoteStatus;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Quote> */
class QuoteFactory extends Factory
{
    public function definition(): array
    {
        return [
            'service_request_id' => ServiceRequest::factory(),
            'provider_id' => User::factory()->provider(),
            'amount_cents' => 18550,
            'available_date' => now('America/Chicago')->addDays(7)->toDateString(),
            'scope' => 'All labor and supplies included. We will leave everything tidy.',
            'status' => QuoteStatus::Pending,
            'version' => 1,
        ];
    }
}
