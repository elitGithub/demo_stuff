<?php

namespace App\Http\Requests;

use App\Data\WeeklyInterval;
use App\Data\WeeklySchedule;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class WeeklyScheduleRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Stylist);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'days' => ['required', 'array', 'size:7'],
            'days.*' => ['required', 'array:weekday,open,opens_at,closes_at'],
            'days.*.weekday' => ['required', 'integer', 'between:0,6', 'distinct'],
            'days.*.open' => ['required', 'boolean'],
            'days.*.opens_at' => ['present', 'nullable', 'date_format:H:i'],
            'days.*.closes_at' => ['present', 'nullable', 'date_format:H:i'],
        ];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'days']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /** @return WeeklySchedule */
    public function inputData(): WeeklySchedule
    {
        return new WeeklySchedule(intervals: collect($this->validated('days'))->filter(fn (array $day): bool => (bool) $day['open'])->map(fn (array $day): WeeklyInterval => new WeeklyInterval(weekday: (int) $day['weekday'], opensAt: (string) $day['opens_at'], closesAt: (string) $day['closes_at']))->values());
    }
}
