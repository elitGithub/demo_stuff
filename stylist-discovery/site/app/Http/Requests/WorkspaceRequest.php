<?php

namespace App\Http\Requests;

use App\Enums\BookingStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class WorkspaceRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['status' => ['nullable', Rule::enum(BookingStatus::class)], 'date' => ['nullable', 'date_format:Y-m-d'], 'page' => ['sometimes', 'integer', 'min:1', 'max:10000']];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['status', 'date', 'page']) !== []) {
            throw ValidationException::withMessages(['form' => 'This filter contains unsupported fields.']);
        }
    }
}
