<?php

namespace Database\Factories;

use App\Enums\MessageDirection;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CaseMessage>
 */
class CaseMessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'case_id' => CaseRecord::factory(),
            'mailbox_message_id' => null,
            'gmail_message_id' => fake()->unique()->bothify('msg-????????????'),
            'thread_id' => fn (array $attributes): ?string => $attributes['case_id'] === null
                ? null
                : CaseRecord::query()->findOrFail($attributes['case_id'])->thread_id,
            'direction' => MessageDirection::Inbound,
            'from_email' => fn (array $attributes): ?string => $attributes['case_id'] === null
                ? null
                : CaseRecord::query()->findOrFail($attributes['case_id'])->sender_email,
            'from_name' => fn (array $attributes): ?string => $attributes['case_id'] === null
                ? null
                : CaseRecord::query()->findOrFail($attributes['case_id'])->sender_name,
            'to_email' => 'desk@casefile.example',
            'subject' => fake()->sentence(5),
            'body_text' => fake()->paragraph(),
            'sent_at' => fake()->dateTimeBetween('-30 days', 'now'),
        ];
    }
}
