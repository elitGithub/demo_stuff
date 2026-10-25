<?php

namespace App\Http\Requests;

use App\Data\RegistrationInput;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RegistrationRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'min:12', 'max:128', 'confirmed'],
            'role' => ['required', Rule::enum(AccountRole::class)->only([AccountRole::Client, AccountRole::Stylist])],
        ];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_method', '_actor_context', 'name', 'email', 'password', 'password_confirmation', 'role']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /**
     * @return RegistrationInput
     */
    public function inputData(): RegistrationInput
    {
        return new RegistrationInput(name: $this->validated('name'), email: mb_strtolower(trim($this->validated('email'))), password: $this->validated('password'), role: AccountRole::from($this->validated('role')));
    }
}
