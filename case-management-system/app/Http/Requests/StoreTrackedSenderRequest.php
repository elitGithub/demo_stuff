<?php

namespace App\Http\Requests;

use App\Support\SenderAddress;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use InvalidArgumentException;

class StoreTrackedSenderRequest extends FormRequest
{
    protected $errorBag = 'addSender';

    protected $redirectRoute = 'settings';

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
        return [
            'email' => ['required', 'email', 'max:254'],
            'name' => ['required', 'string', 'max:120'],
            'label' => ['nullable', 'string', 'max:60'],
        ];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            try {
                $this->merge(['email' => SenderAddress::fromHeader($this->input('email'))->email]);
            } catch (InvalidArgumentException) {
                return;
            }
        }
    }
}
