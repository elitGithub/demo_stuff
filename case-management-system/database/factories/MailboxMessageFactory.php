<?php

namespace Database\Factories;

use App\Enums\MailboxLabel;
use App\Models\MailboxMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MailboxMessage>
 */
class MailboxMessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $body = fake()->paragraph();

        return [
            'gmail_message_id' => fake()->unique()->bothify('mbx-????????????'),
            'thread_id' => fake()->bothify('thread-????????????'),
            'label' => MailboxLabel::Inbox,
            'from_email' => fake()->userName().'@mail.example',
            'from_name' => fake()->name(),
            'to_email' => 'desk@casefile.example',
            'subject' => fake()->sentence(5),
            'body_text' => $body,
            'snippet' => mb_substr($body, 0, 160),
            'is_notification' => false,
            'received_at' => fake()->dateTimeBetween('-30 days', 'now'),
        ];
    }
}
