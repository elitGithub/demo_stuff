<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class InboxReadRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return $this->routeIs('inbox.read') ? ['page' => ['sometimes', 'integer', 'min:1', 'max:10000'], 'appointments_page' => ['sometimes', 'integer', 'min:1', 'max:10000']] : [];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        $allowed = ['_token', '_actor_context'];
        if ($this->routeIs('inbox.read')) {
            $allowed = array_merge($allowed, ['page', 'appointments_page']);
        }
        if (array_diff(array_keys($this->all()), $allowed) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }
}
