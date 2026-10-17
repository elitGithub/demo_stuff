<?php

namespace Database\Factories;

use App\Models\Attachment;
use App\Models\CaseMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Attachment>
 */
class AttachmentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $filename = fake()->unique()->lexify('????????').'.pdf';

        return [
            'case_message_id' => CaseMessage::factory(),
            'filename' => $filename,
            'mime_type' => 'application/pdf',
            'size_bytes' => fake()->numberBetween(1024, 500000),
            'storage_path' => 'attachments/'.$filename,
        ];
    }
}
