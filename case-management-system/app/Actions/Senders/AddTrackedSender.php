<?php

namespace App\Actions\Senders;

use App\Intake\TrackedSenderBackfill;
use App\Models\TrackedSender;
use App\Support\SenderAddress;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

final class AddTrackedSender
{
    /**
     * @param  TrackedSenderBackfill  $backfill
     */
    public function __construct(private readonly TrackedSenderBackfill $backfill) {}

    /**
     * @param  string  $emailHeader
     * @param  string  $name
     * @param  ?string  $label
     * @return TrackedSender
     *
     * @throws ValidationException
     */
    public function __invoke(string $emailHeader, string $name, ?string $label): TrackedSender
    {
        try {
            $address = SenderAddress::fromHeader($emailHeader);
        } catch (InvalidArgumentException) {
            throw ValidationException::withMessages(['email' => 'Enter a valid email address.']);
        }

        try {
            return DB::transaction(function () use ($address, $name, $label): TrackedSender {
                if (TrackedSender::query()->where('email', $address->email)->exists()) {
                    throw ValidationException::withMessages(['email' => 'This email address is already tracked.']);
                }

                $sender = TrackedSender::query()->create([
                    'email' => $address->email,
                    'name' => $name,
                    'label' => $label,
                    'is_active' => true,
                ]);
                $this->backfill->run($sender);

                return $sender;
            });
        } catch (UniqueConstraintViolationException $exception) {
            if (TrackedSender::query()->where('email', $address->email)->exists()) {
                throw ValidationException::withMessages(['email' => 'This email address is already tracked.']);
            }

            throw $exception;
        }
    }
}
