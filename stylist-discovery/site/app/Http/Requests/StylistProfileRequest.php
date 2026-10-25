<?php

namespace App\Http\Requests;

use App\Data\StylistInput;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class StylistProfileRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Stylist);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'display_name' => ['nullable', 'string', 'max:80', 'not_regex:/[<>]/u'],
            'studio_name' => ['nullable', 'string', 'max:80', 'not_regex:/[<>]/u'],
            'biography' => ['nullable', 'string', 'max:1200', 'not_regex:/[<>]/u'],
            'address' => ['nullable', 'string', 'max:180', 'not_regex:/[<>]/u'],
            'city_code' => ['required', 'string', Rule::in(array_keys(config('demo.locations')))],
            'deposit_percent' => ['required', 'integer', 'between:10,100'],
            'specialty_ids' => ['sometimes', 'array', 'max:6'],
            'specialty_ids.*' => ['required', 'integer', 'distinct', Rule::exists('visitor.specialties', 'id')->where('enabled', true)],
        ];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'display_name', 'studio_name', 'biography', 'address', 'city_code', 'deposit_percent', 'specialty_ids']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /**
     * @return StylistInput
     */
    public function inputData(): StylistInput
    {
        return new StylistInput(displayName: $this->validated('display_name') ?? '', studioName: $this->validated('studio_name') ?? '', biography: $this->validated('biography') ?? '', address: $this->validated('address') ?? '', cityCode: $this->validated('city_code'), depositPercent: (int) $this->validated('deposit_percent'), specialtyIds: collect($this->validated('specialty_ids', []))->map(fn ($specialtyId): int => (int) $specialtyId));
    }
}
