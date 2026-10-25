<?php

namespace App\Http\Requests;

use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class ReviewStylistRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Admin);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_actor_context']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }
}
