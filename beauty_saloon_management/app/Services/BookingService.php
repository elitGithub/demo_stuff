<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Stylist;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class BookingService
{
    public function slots(Stylist $stylist, array $serviceIds, string $date): array
    {
        $services = $this->services($stylist, $serviceIds);
        $day = CarbonImmutable::parse($date, config('studio.timezone'))->startOfDay();
        if (! in_array($day->dayOfWeek, $stylist->working_days ?? [1, 2, 3, 4, 5, 6], true)) {
            return [];
        }
        $duration = $services->sum('duration');
        $slots = [];
        for ($start = $day->setTimeFromTimeString($stylist->start_time); $start->addMinutes($duration)->lte($day->setTimeFromTimeString($stylist->end_time)); $start = $start->addMinutes(15)) {
            if ($start->isFuture() && $this->available($stylist, $start->utc(), $start->addMinutes($duration)->utc())) {
                $slots[] = $start->format('H:i');
            }
        }

        return $slots;
    }

    public function book(array $data): Appointment
    {
        $data = Validator::make($data, [
            'stylist_id' => 'required|integer|exists:stylists,id',
            'service_ids' => 'required|array|min:1|max:10',
            'service_ids.*' => 'required|integer|distinct|exists:services,id',
            'date' => 'required|date_format:Y-m-d', 'time' => 'required|date_format:H:i',
            'client_id' => 'nullable|integer|exists:clients,id',
            'name' => 'required_without:client_id|nullable|string|max:120',
            'email' => 'nullable|email|max:200', 'phone' => 'nullable|string|max:30',
            'channels' => 'nullable|array|max:3', 'channels.*' => 'in:email,sms,whatsapp|distinct',
            'notes' => 'nullable|string|max:2000',
        ])->validate();

        return DB::transaction(function () use ($data) {
            // The first statement acquires the write lock on SQLite as well as MySQL.
            Stylist::whereKey($data['stylist_id'])->increment('lock_version');
            $stylist = Stylist::findOrFail($data['stylist_id']);
            $services = $this->services($stylist, $data['service_ids']);
            $start = CarbonImmutable::createFromFormat('!Y-m-d H:i', $data['date'].' '.$data['time'], config('studio.timezone'));
            $end = $start->addMinutes($services->sum('duration'));
            $this->assertTime($stylist, $start, $end);
            $client = isset($data['client_id']) ? Client::findOrFail($data['client_id']) : Client::create([
                'name' => $data['name'], 'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null, 'channels' => $data['channels'] ?? [], 'source' => 'website',
            ]);
            $appointment = Appointment::create([
                'client_id' => $client->id, 'stylist_id' => $stylist->id,
                'starts_at' => $start->utc(), 'ends_at' => $end->utc(),
                'status' => 'booked', 'total' => $services->sum('price'), 'notes' => $data['notes'] ?? null,
            ]);
            foreach ($services as $service) {
                $appointment->items()->create(['service_id' => $service->id, 'name' => $service->name, 'price' => $service->price, 'duration' => $service->duration]);
            }
            app(ReminderService::class)->schedule($appointment);

            return $appointment;
        }, 5);
    }

    public function reschedule(Appointment $appointment, string $date, string $time): void
    {
        Validator::make(compact('date', 'time'), ['date' => 'required|date_format:Y-m-d', 'time' => 'required|date_format:H:i'])->validate();
        DB::transaction(function () use ($appointment, $date, $time) {
            Stylist::whereKey($appointment->stylist_id)->increment('lock_version');
            $appointment = Appointment::lockForUpdate()->findOrFail($appointment->id);
            if (! in_array($appointment->status, ['booked', 'confirmed'], true)) {
                throw ValidationException::withMessages(['appointment' => 'Only upcoming appointments can be rescheduled.']);
            }
            $start = CarbonImmutable::createFromFormat('!Y-m-d H:i', "$date $time", config('studio.timezone'));
            $end = $start->addMinutes($appointment->items()->sum('duration'));
            $this->assertTime($appointment->stylist, $start, $end, $appointment->id);
            $appointment->update(['starts_at' => $start->utc(), 'ends_at' => $end->utc()]);
            app(ReminderService::class)->schedule($appointment->fresh());
        }, 5);
    }

    public function transition(Appointment $appointment, string $status): void
    {
        DB::transaction(function () use ($appointment, $status) {
            Stylist::whereKey($appointment->stylist_id)->increment('lock_version');
            $appointment = Appointment::lockForUpdate()->findOrFail($appointment->id);
            $allowed = ['booked' => ['confirmed', 'completed', 'cancelled', 'no_show'], 'confirmed' => ['completed', 'cancelled', 'no_show']];
            if (! in_array($status, $allowed[$appointment->status] ?? [], true)) {
                throw ValidationException::withMessages(['status' => 'This appointment cannot move to that status.']);
            }
            if (in_array($status, ['completed', 'no_show'], true) && $appointment->starts_at->isFuture()) {
                throw ValidationException::withMessages(['status' => 'The appointment has not started yet.']);
            }
            $appointment->update(['status' => $status]);
            if (in_array($status, ['cancelled', 'no_show', 'completed'], true)) {
                $appointment->reminders()->where('status', 'pending')->update(['status' => 'cancelled']);
            }
        }, 5);
    }

    private function services(Stylist $stylist, array $ids): Collection
    {
        $ids = array_unique(array_map('intval', $ids));
        $services = $stylist->services()->where('services.active', true)->whereIn('services.id', $ids)->get();
        if (! $stylist->active || count($ids) === 0 || $services->count() !== count($ids)) {
            throw ValidationException::withMessages(['service_ids' => 'Please choose active services offered by this stylist.']);
        }

        return $services;
    }

    private function assertTime(Stylist $stylist, CarbonImmutable $start, CarbonImmutable $end, ?int $ignore = null): void
    {
        if ($start->isPast() || $start->gt(now()->addMonths(6)) || ! in_array($start->dayOfWeek, $stylist->working_days ?? [1, 2, 3, 4, 5, 6], true) || $start->format('H:i') < $stylist->start_time || ! $start->isSameDay($end) || $end->format('H:i') > $stylist->end_time || ! $this->available($stylist, $start->utc(), $end->utc(), $ignore)) {
            throw ValidationException::withMessages(['time' => 'That time is unavailable. Choose a future time within the stylist’s working hours.']);
        }
    }

    private function available(Stylist $stylist, CarbonImmutable $start, CarbonImmutable $end, ?int $ignore = null): bool
    {
        return ! $stylist->appointments()->whereIn('status', ['booked', 'confirmed'])->when($ignore, fn ($query) => $query->where('id', '!=', $ignore))->where('starts_at', '<', $end)->where('ends_at', '>', $start)->exists()
            && ! $stylist->timeOffs()->where('starts_at', '<', $end)->where('ends_at', '>', $start)->exists();
    }
}
