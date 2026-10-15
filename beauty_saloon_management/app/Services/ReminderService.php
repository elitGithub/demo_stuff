<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Reminder;
use Illuminate\Support\Facades\DB;

class ReminderService
{
    public function schedule(Appointment $appointment, bool $resetProcessed = true): void
    {
        $client = $appointment->client;
        $appointment->reminders()->where('status', 'pending')->update(['status' => 'cancelled']);
        foreach (array_intersect($client->channels ?? [], ['email', 'sms', 'whatsapp']) as $channel) {
            $recipient = $channel === 'email' ? $client->email : $client->phone;
            if (! $recipient) {
                continue;
            }
            if (! $resetProcessed && $appointment->reminders()->where('channel', $channel)->whereIn('status', ['simulated', 'processing'])->exists()) {
                continue;
            }
            $appointment->reminders()->updateOrCreate(['channel' => $channel], [
                'recipient' => $recipient,
                'body' => 'Hi '.$client->name.', a little reminder: your appointment at '.config('studio.name').' with '.$appointment->stylist->name.' is on '.$appointment->localStart()->format('D, M j \a\t H:i').'. We look forward to seeing you.',
                'scheduled_at' => $appointment->starts_at->subDay()->max(now()), 'status' => 'pending', 'processed_at' => null, 'attempts' => 0,
            ]);
        }
    }

    public function processDue(): int
    {
        $processed = 0;
        Reminder::where('status', 'pending')->where('scheduled_at', '<=', now())->chunkById(100, function ($reminders) use (&$processed) {
            foreach ($reminders as $reminder) {
                DB::transaction(function () use ($reminder, &$processed) {
                    $claimed = Reminder::whereKey($reminder->id)->where('status', 'pending')->where('scheduled_at', '<=', now())->update(['status' => 'processing']);
                    if (! $claimed) {
                        return;
                    }
                    $reminder->refresh();
                    $appointment = $reminder->appointment()->with('client')->first();
                    $recipient = $reminder->channel === 'email' ? $appointment->client->email : $appointment->client->phone;
                    $eligible = $recipient && $recipient === $reminder->recipient && in_array($appointment->status, ['booked', 'confirmed'], true) && $appointment->starts_at->isFuture() && in_array($reminder->channel, $appointment->client->channels ?? [], true);
                    $reminder->update(['status' => $eligible ? 'simulated' : 'cancelled', 'processed_at' => now(), 'attempts' => $reminder->attempts + 1]);
                    if ($eligible) {
                        $processed++;
                    }
                }, 5);
            }
        });

        return $processed;
    }
}
