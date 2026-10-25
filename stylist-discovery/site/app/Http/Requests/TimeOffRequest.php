<?php

namespace App\Http\Requests;

use App\Data\TimeOffInput;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class TimeOffRequest extends FormRequest
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
            'starts_local' => ['required', 'string', 'date_format:Y-m-d H:i'],
            'ends_local' => ['required', 'string', 'date_format:Y-m-d H:i'],
        ];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'starts_local', 'ends_local']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
        foreach (['starts_local', 'ends_local'] as $field) {
            if (is_string($this->input($field)) && preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\z/', $this->input($field))) {
                $this->merge([$field => str_replace('T', ' ', $this->input($field))]);
            }
        }
    }

    /** @return TimeOffInput */
    public function inputData(): TimeOffInput
    {
        return new TimeOffInput(startsLocal: $this->validated('starts_local'), endsLocal: $this->validated('ends_local'));
    }
}
