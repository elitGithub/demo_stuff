<?php

namespace Database\Factories;

use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use App\Models\TrackedSender;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CaseRecord>
 */
class CaseRecordFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'number' => sprintf('CASE-%04d', fake()->unique()->numberBetween(5000, 9999)),
            'status' => CaseStatus::Open,
            'issue' => null,
            'notes' => null,
            'tracked_sender_id' => TrackedSender::factory(),
            'sender_email' => fn (array $attributes): ?string => $attributes['tracked_sender_id'] === null
                ? null
                : TrackedSender::query()->findOrFail($attributes['tracked_sender_id'])->email,
            'sender_name' => fn (array $attributes): ?string => $attributes['tracked_sender_id'] === null
                ? null
                : TrackedSender::query()->findOrFail($attributes['tracked_sender_id'])->name,
            'subject' => fake()->sentence(5),
            'thread_id' => fake()->unique()->bothify('thread-????????????'),
            'received_at' => fake()->dateTimeBetween('-30 days', 'now'),
            'closed_at' => null,
        ];
    }
}
