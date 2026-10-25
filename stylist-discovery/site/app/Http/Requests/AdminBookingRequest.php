<?php

namespace App\Http\Requests;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AdminBookingRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Admin);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['status' => ['nullable', Rule::enum(BookingStatus::class)], 'page' => ['sometimes', 'integer', 'between:1,10000']];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['status', 'page']) !== []) {
            throw ValidationException::withMessages(['form' => 'This filter contains unsupported fields.']);
        }
    }
}
