<?php

namespace Database\Factories;

use App\Models\TrackedSender;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TrackedSender>
 */
class TrackedSenderFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'email' => fake()->unique()->userName().'@mail.example',
            'name' => fake()->name(),
            'label' => fake()->optional()->randomElement(['Client', 'Supplier', 'Partner']),
            'is_active' => true,
        ];
    }
}
