<?php

namespace Database\Factories;

use App\Enums\CaseEventKind;
use App\Models\CaseEvent;
use App\Models\CaseRecord;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CaseEvent>
 */
class CaseEventFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'case_id' => CaseRecord::factory(),
            'kind' => CaseEventKind::Created,
            'from_status' => null,
            'to_status' => null,
            'occurred_at' => fake()->dateTimeBetween('-30 days', 'now'),
        ];
    }
}
