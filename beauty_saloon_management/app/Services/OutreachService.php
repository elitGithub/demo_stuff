<?php

namespace App\Services;

use App\Models\Client;
use App\Models\MarketingMessage;
use App\Models\StudioSetting;
use App\Models\Subscriber;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OutreachService
{
    public function generateDue(): int
    {
        $today = CarbonImmutable::now(config('studio.timezone'));
        $studioName = StudioSetting::where('key', 'name')->value('value') ?? config('studio.name');
        $created = 0;
        Client::where(function ($query) use ($today) {
            $query->where(function ($birthday) use ($today) {
                $birthday->whereMonth('birthday', $today->month)->whereDay('birthday', $today->day);
            })->orWhere(function ($anniversary) use ($today) {
                $anniversary->whereMonth('anniversary', $today->month)->whereDay('anniversary', $today->day);
            });
        })->chunkById(100, function ($clients) use ($today, $studioName, &$created) {
            foreach ($clients as $client) {
                foreach (['birthday', 'anniversary'] as $kind) {
                    if (! $client->{$kind} || $client->{$kind}->format('m-d') !== $today->format('m-d')) {
                        continue;
                    }
                    foreach (array_intersect($client->marketing_channels ?? [], ['email', 'sms', 'whatsapp']) as $channel) {
                        $recipient = $channel === 'email' ? $client->email : $client->phone;
                        if (! $recipient) {
                            continue;
                        }
                        $message = MarketingMessage::firstOrCreate(['dedupe_key' => $kind.':'.$client->id.':'.$today->year.':'.$channel], [
                            'client_id' => $client->id, 'kind' => $kind, 'channel' => $channel, 'recipient' => $recipient,
                            'subject' => 'Happy '.$kind.' from '.$studioName,
                            'body' => 'Hi '.$client->name.', wishing you a wonderful '.$kind.' from all of us at '.$studioName.'. We would love to welcome you for a little time for yourself.',
                            'due_date' => $today->toDateString(),
                        ]);
                        $created += (int) $message->wasRecentlyCreated;
                    }
                }
            }
        });

        return $created;
    }

    public function previewNewsletter(string $subject, string $body, string $campaignKey): int
    {
        $existing = MarketingMessage::where('campaign_key', $campaignKey)->first();
        if ($existing && ($existing->subject !== $subject || $existing->body !== $body)) {
            throw ValidationException::withMessages(['campaign_key' => 'This preview has already been created with different content. Reload to start a new campaign.']);
        }
        $created = 0;
        Subscriber::whereNull('unsubscribed_at')->whereNotNull('consented_at')->chunkById(100, function ($subscribers) use ($subject, $body, $campaignKey, &$created) {
            foreach ($subscribers as $subscriber) {
                $message = MarketingMessage::firstOrCreate(['dedupe_key' => 'newsletter:'.$campaignKey.':'.$subscriber->id], [
                    'subscriber_id' => $subscriber->id, 'kind' => 'newsletter', 'channel' => 'email', 'recipient' => $subscriber->email,
                    'subject' => $subject, 'body' => $body, 'campaign_key' => $campaignKey,
                    'due_date' => CarbonImmutable::now(config('studio.timezone'))->toDateString(),
                ]);
                $created += (int) $message->wasRecentlyCreated;
            }
        });

        return $created;
    }

    public function processDue(): int
    {
        $today = CarbonImmutable::now(config('studio.timezone'));
        $processed = 0;
        MarketingMessage::where('status', 'pending')->whereDate('due_date', '<=', $today->toDateString())->chunkById(100, function ($messages) use ($today, &$processed) {
            foreach ($messages as $message) {
                DB::transaction(function () use ($message, $today, &$processed) {
                    $claimed = MarketingMessage::whereKey($message->id)->where('status', 'pending')->whereDate('due_date', '<=', $today->toDateString())->update(['status' => 'processing']);
                    if (! $claimed) {
                        return;
                    }
                    $message->refresh();
                    $eligible = $this->eligible($message, $today);
                    $message->update(['status' => $eligible ? 'simulated' : 'cancelled', 'processed_at' => now(), 'attempts' => $message->attempts + 1]);
                    $processed += (int) $eligible;
                }, 5);
            }
        });

        return $processed;
    }

    private function eligible(MarketingMessage $message, CarbonImmutable $today): bool
    {
        if ($message->kind === 'newsletter') {
            $subscriber = $message->subscriber()->lockForUpdate()->first();

            return $subscriber && $subscriber->consented_at && ! $subscriber->unsubscribed_at && $subscriber->email === $message->recipient;
        }
        if (! in_array($message->kind, ['birthday', 'anniversary'], true)) {
            return false;
        }
        $client = $message->client()->lockForUpdate()->first();
        $date = $client?->{$message->kind};
        $recipient = $message->channel === 'email' ? $client?->email : $client?->phone;

        return $client && $date && $message->due_date->toDateString() === $today->toDateString()
            && $date->format('m-d') === $today->format('m-d')
            && $recipient === $message->recipient
            && in_array($message->channel, $client->marketing_channels ?? [], true);
    }
}
