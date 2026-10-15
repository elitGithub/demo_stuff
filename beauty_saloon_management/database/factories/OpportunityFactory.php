<?php

namespace Database\Factories;

use App\Models\Client;
use App\Models\Opportunity;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Opportunity> */
class OpportunityFactory extends Factory
{
    public function definition(): array
    {
        return [
            'reference' => 'ENQ-'.Str::uuid(),
            'client_id' => fn () => Client::create(['name' => fake()->name(), 'email' => fake()->safeEmail()])->id,
            'assigned_to' => User::factory()->state(['role' => 'staff', 'active' => true]),
            'created_by' => fn (array $attributes) => $attributes['assigned_to'],
            'title' => 'Bridal styling enquiry',
            'kind' => 'enquiry',
            'guest_count' => 1,
            'stage' => 'lead',
            'stage_entered_at' => now(),
            'stage_details' => ['lead' => ['occurred_on' => now(config('studio.timezone'))->toDateString(), 'reference' => null, 'remarks' => null]],
            'next_action' => 'Call the organiser',
            'next_follow_up_at' => now()->addDay(),
        ];
    }
}
