<?php

namespace App\Http\Requests;

use App\Data\LoginInput;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'min:12', 'max:128'],
        ];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'email', 'password']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /**
     * @return LoginInput
     */
    public function inputData(): LoginInput
    {
        return new LoginInput(email: mb_strtolower(trim($this->validated('email'))), password: $this->validated('password'));
    }
}
