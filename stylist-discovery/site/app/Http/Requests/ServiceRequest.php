<?php

namespace App\Http\Requests;

use App\Data\ServiceInput;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ServiceRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        if ($this->route('service') !== null) {
            abort_unless($this->user()->profile()->whereHas('services', fn ($services) => $services->where('id', (int) $this->route('service')))->exists(), 404);
        }

        return $this->user()->hasRole(AccountRole::Stylist);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80', 'not_regex:/[<>]/u'],
            'specialty_id' => ['required', 'integer', Rule::exists('visitor.specialties', 'id')],
            'price' => ['required', 'string', 'regex:/\A(?:[1-9][0-9]{0,2}(?:\.[0-9]{1,2})?|1000(?:\.0{1,2})?)\z/'],
            'duration_minutes' => ['required', 'integer', 'between:15,240'],
            'active' => ['required', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['price.regex' => 'Enter a price from €1 to €1,000 with up to two decimal places.'];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'name', 'specialty_id', 'price', 'duration_minutes', 'active']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /**
     * @return ServiceInput
     */
    public function inputData(): ServiceInput
    {
        $parts = explode('.', $this->validated('price'));

        return new ServiceInput(name: $this->validated('name'), specialtyId: (int) $this->validated('specialty_id'), priceCents: ((int) $parts[0] * 100) + (int) str_pad($parts[1] ?? '', 2, '0'), durationMinutes: (int) $this->validated('duration_minutes'), active: $this->boolean('active'));
    }
}
