<?php

namespace Database\Factories;

use App\Enums\ScriptEntryKind;
use App\Models\ScriptEntry;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ScriptEntry>
 */
class ScriptEntryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'kind' => ScriptEntryKind::Delivery,
            'position' => fake()->unique()->numberBetween(1, 100000),
            'thread_id' => null,
            'payload' => [
                'from_email' => fake()->userName().'@mail.example',
                'from_name' => fake()->name(),
                'subject' => fake()->sentence(5),
                'body_text' => fake()->paragraph(),
            ],
            'delivered_at' => null,
        ];
    }
}
