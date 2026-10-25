<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class SlotRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'service' => ['required', 'integer', 'min:1'],
            'date' => ['sometimes', 'required', 'string', 'date_format:Y-m-d'],
        ];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['service', 'date']) !== []) {
            throw ValidationException::withMessages(['form' => 'Choose a service and a date.']);
        }
    }
}
