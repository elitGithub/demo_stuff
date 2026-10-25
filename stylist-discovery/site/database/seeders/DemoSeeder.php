<?php

namespace Database\Seeders;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Enums\PaymentKind;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Payment;
use App\Models\PortfolioImage;
use App\Models\SandboxMeta;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Models\WorkingHours;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DemoSeeder extends Seeder
{
    /**
     * @return void
     */
    public function run(): void
    {
        foreach (config('demo.seed.specialties') as $slug => $specialty) {
            Specialty::query()->create(['name' => $specialty['name'], 'slug' => $slug, 'enabled' => true]);
        }

        foreach (config('demo.seed.clients') as $client) {
            User::query()->create([...$client, 'role' => AccountRole::Client, 'password' => bin2hex(random_bytes(48))]);
        }

        User::query()->create([...config('demo.seed.admin'), 'role' => AccountRole::Admin, 'password' => bin2hex(random_bytes(48))]);

        foreach (config('demo.seed.profiles') as $profileIndex => $catalogue) {
            $user = User::query()->create(['name' => $catalogue['name'], 'email' => $catalogue['email'], 'role' => AccountRole::Stylist, 'password' => bin2hex(random_bytes(48))]);
            $profile = StylistProfile::query()->create([
                'user_id' => $user->id, 'display_name' => $catalogue['name'], 'studio_name' => $catalogue['studio'],
                'biography' => $catalogue['biography'], 'address' => $catalogue['address'], 'city_code' => $catalogue['city'],
                'timezone' => config('demo.locations.'.$catalogue['city'].'.timezone'), 'status' => ProfileStatus::Published,
                'deposit_percent' => $catalogue['deposit_percent'], 'portrait_asset' => $catalogue['portrait'],
            ]);
            $specialties = Specialty::query()->whereIn('slug', $catalogue['specialties'])->orderBy('id')->get();
            $profile->specialties()->attach($specialties->modelKeys());

            foreach (config('demo.seed.service_variants') as $variantIndex => $variant) {
                $specialty = $specialties[$variantIndex % $specialties->count()];
                $definition = config('demo.seed.specialties.'.$specialty->slug);
                Service::query()->create([
                    'profile_id' => $profile->id, 'specialty_id' => $specialty->id,
                    'name' => $definition['service'].$variant['suffix'],
                    'price_cents' => $definition['price_cents'] + $variant['price_adjustment'],
                    'duration_minutes' => $definition['duration_minutes'] + $variant['duration_adjustment'], 'active' => true,
                ]);
                PortfolioImage::query()->create([
                    'profile_id' => $profile->id, 'seed_asset' => sprintf('work-%02d.svg', $profileIndex * 3 + $variantIndex + 1),
                    'caption' => config('demo.seed.portfolio_caption'), 'position' => $variantIndex,
                ]);
            }

            foreach (range(0, 6) as $weekday) {
                WorkingHours::query()->create(['profile_id' => $profile->id, 'weekday' => $weekday, ...config('demo.seed.hours')]);
            }
        }

        SandboxMeta::query()->create(['id' => 1, 'generation' => '', 'access_lock_version' => 0]);
        $client = User::query()->where('email', config('demo.seed_accounts.client'))->sole();
        $profile = User::query()->where('email', config('demo.seed_accounts.stylist'))->sole()->profile;
        $service = $profile->services()->orderBy('id')->firstOrFail();
        $anchor = CarbonImmutable::create(2000, 1, 15, 12, 0, 0, 'UTC');

        foreach (config('demo.seed.bookings') as $seedKey => $definition) {
            $startsAt = $anchor->setTimezone($profile->timezone)->addDays($definition['days'])->setTime($definition['hour'], 0)->utc();
            $status = BookingStatus::from($definition['status']);
            $depositCents = intdiv($service->price_cents * $profile->deposit_percent + 50, 100);
            $acceptedAt = match ($status) {
                BookingStatus::Requested => null,
                BookingStatus::AwaitingDeposit => $anchor,
                BookingStatus::Confirmed => $anchor->subHour(),
                BookingStatus::Completed => $startsAt->subDay(),
            };
            $requestedAt = $status === BookingStatus::Completed ? $startsAt->subDays(2) : $anchor->subHours(2);
            $booking = Booking::query()->create([
                'client_id' => $client->id, 'profile_id' => $profile->id, 'service_id' => $service->id,
                'request_key' => (string) Str::uuid(), 'input_fingerprint' => hash('sha256', $seedKey),
                'service_name' => $service->name, 'price_cents' => $service->price_cents, 'duration_minutes' => $service->duration_minutes,
                'deposit_percent' => $profile->deposit_percent, 'deposit_cents' => $depositCents,
                'remaining_cents' => $service->price_cents - $depositCents, 'currency' => config('demo.currency'), 'timezone' => $profile->timezone,
                'starts_at' => $startsAt, 'ends_at' => $startsAt->addMinutes($service->duration_minutes),
                'status' => $status, 'accepted_at' => $acceptedAt,
                'deposit_deadline' => $acceptedAt?->addMinutes(config('demo.booking.hold_minutes'))->min($startsAt),
                'notification_budget' => $definition['budget'], 'seed_key' => $seedKey,
                'created_at' => $requestedAt, 'updated_at' => $acceptedAt ?? $requestedAt,
            ]);
            $events = collect([InboxEvent::RequestReceived]);

            if ($status !== BookingStatus::Requested) {
                $events->push(InboxEvent::RequestAccepted);
            }

            if (in_array($status, [BookingStatus::Confirmed, BookingStatus::Completed], true)) {
                Payment::query()->create(['booking_id' => $booking->id, 'kind' => PaymentKind::Deposit, 'amount_cents' => $depositCents, 'currency' => config('demo.currency'), 'created_at' => $acceptedAt, 'updated_at' => $acceptedAt]);
                $events->push(InboxEvent::DepositPaid);
            }

            foreach ($events as $event) {
                $recipients = $event === InboxEvent::RequestReceived ? collect([$profile->user_id]) : ($event === InboxEvent::DepositPaid ? collect([$client->id, $profile->user_id]) : collect([$client->id]));

                foreach ($recipients as $recipientId) {
                    InboxMessage::query()->create([
                        'recipient_id' => $recipientId, 'booking_id' => $booking->id, 'event' => $event,
                        'event_key' => $booking->id.':'.$event->value,
                        ...config('demo.seed.inbox.'.$event->value),
                        'created_at' => $event === InboxEvent::RequestReceived ? $requestedAt : $acceptedAt,
                        'updated_at' => $event === InboxEvent::RequestReceived ? $requestedAt : $acceptedAt,
                    ]);
                }
            }
        }
    }
}
