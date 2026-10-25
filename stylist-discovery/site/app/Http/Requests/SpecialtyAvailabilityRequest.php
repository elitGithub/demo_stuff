<?php

namespace App\Http\Requests;

use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class SpecialtyAvailabilityRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Admin);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['enabled' => ['required', 'boolean']];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_actor_context', 'enabled']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }
}
