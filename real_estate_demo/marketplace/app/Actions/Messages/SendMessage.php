<?php

namespace App\Actions\Messages;

use App\Models\Message;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class SendMessage
{
    public function handle(User $actor, Quote $quote, string $body): Message
    {
        return DB::transaction(function () use ($actor, $quote, $body): Message {
            $job = ServiceRequest::whereKey($quote->service_request_id)->lockForUpdate()->firstOrFail();
            $current = Quote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            $current->setRelation('serviceRequest', $job);
            $profile = ProviderProfile::where('user_id', $current->provider_id)->lockForUpdate()->first();
            $current->provider->setRelation('profile', $profile);
            Gate::forUser($actor)->authorize('sendMessage', $current);

            $message = $current->messages()->create(['sender_id' => $actor->id, 'body' => trim($body)]);
            $recipient = $actor->id === $current->provider_id ? $job->customer : $current->provider;
            $recipient->notify(new MarketplaceNotification(
                'A new message from '.Str::before($actor->name, ' '),
                Str::limit($message->body, 120), 'conversations.show', ['quote' => $current->id],
            ));

            return $message;
        }, 3);
    }
}
