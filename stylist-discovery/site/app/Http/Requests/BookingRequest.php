<?php

namespace App\Http\Requests;

use App\Data\BookingInput;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class BookingRequest extends FormRequest
{
    /** @return bool */
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['service' => ['required', 'integer', 'min:1'], 'starts_local' => ['required', 'string', 'date_format:Y-m-d H:i'], 'request_key' => [$this->isMethod('GET') ? 'prohibited' : 'required', 'uuid'], 'note' => ['nullable', 'string', 'max:500']];
    }

    /** @return void */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_actor_context', 'service', 'starts_local', 'request_key', 'note']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /** @return BookingInput */
    public function inputData(): BookingInput
    {
        return new BookingInput(serviceId: (int) $this->validated('service'), startsLocal: $this->validated('starts_local'), requestKey: $this->validated('request_key'), note: $this->validated('note'));
    }
}
