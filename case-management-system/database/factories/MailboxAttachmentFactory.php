<?php

namespace Database\Factories;

use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MailboxAttachment>
 */
class MailboxAttachmentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $filename = fake()->unique()->lexify('????????').'.pdf';

        return [
            'mailbox_message_id' => MailboxMessage::factory(),
            'filename' => $filename,
            'mime_type' => 'application/pdf',
            'size_bytes' => fake()->numberBetween(1024, 500000),
            'storage_path' => 'mailbox/'.$filename,
        ];
    }
}
