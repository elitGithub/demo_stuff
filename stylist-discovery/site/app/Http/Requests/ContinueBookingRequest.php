<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class ContinueBookingRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return ['service' => ['required', 'integer', 'min:1'], 'starts_local' => ['required', 'string', 'date_format:Y-m-d H:i']];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_actor_context', 'service', 'starts_local']) !== []) {
            throw \Illuminate\Validation\ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }
}
