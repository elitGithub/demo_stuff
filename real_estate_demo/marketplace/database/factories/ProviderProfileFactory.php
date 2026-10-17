<?php

namespace Database\Factories;

use App\Enums\ProviderStatus;
use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ProviderProfile> */
class ProviderProfileFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory()->provider(),
            'business_name' => fake()->company(),
            'slug' => fake()->unique()->slug(3),
            'bio' => 'Careful, reliable home services with a personal touch.',
            'service_areas' => ['Austin'],
            'status' => ProviderStatus::Pending,
        ];
    }
}
