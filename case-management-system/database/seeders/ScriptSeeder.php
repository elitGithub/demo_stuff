<?php

namespace Database\Seeders;

use App\Enums\FixtureFile;
use App\Enums\ScriptEntryKind;
use App\Models\ScriptEntry;
use Illuminate\Database\Seeder;
use RuntimeException;

class ScriptSeeder extends Seeder
{
    /**
     * @return void
     *
     * @throws RuntimeException
     */
    public function run(): void
    {
        $script = require database_path('seeders/data/script.php');
        $attachments = fn (array $fixtures): array => array_map(fn (FixtureFile $fixture): array => [
            'filename' => $fixture->value,
            'mime_type' => $fixture->mimeType(),
            'size_bytes' => $fixture->sizeBytes(),
        ], $fixtures);

        foreach ($script['deliveries'] as $index => $delivery) {
            ScriptEntry::query()->create([
                'kind' => ScriptEntryKind::Delivery,
                'position' => $index + 1,
                'thread_id' => $delivery['thread_id'],
                'payload' => [
                    'from' => $delivery['from'],
                    'subject' => $delivery['subject'],
                    'body_text' => $delivery['body_text'],
                    'thread_id' => $delivery['thread_id'],
                    'attachments' => $attachments($delivery['attachments']),
                ],
                'delivered_at' => null,
            ]);
        }

        foreach ($script['replies'] as $reply) {
            ScriptEntry::query()->create([
                'kind' => ScriptEntryKind::ScriptedReply,
                'position' => null,
                'thread_id' => $reply['thread_id'],
                'payload' => [
                    'thread_id' => $reply['thread_id'],
                    'from' => $reply['from'],
                    'body_text' => $reply['body_text'],
                    'attachments' => $attachments($reply['attachments']),
                ],
                'delivered_at' => null,
            ]);
        }
    }
}
