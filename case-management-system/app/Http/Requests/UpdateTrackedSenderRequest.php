<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateTrackedSenderRequest extends FormRequest
{
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
            'name' => ['required', 'string', 'max:120'],
            'label' => ['nullable', 'string', 'max:60'],
        ];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        $this->errorBag = 'renameSender'.$this->route('sender')->getKey();
    }

    /**
     * @return string
     */
    protected function getRedirectUrl(): string
    {
        $page = filter_var($this->query('page'), FILTER_VALIDATE_INT);

        return route('settings', ['page' => max(1, $page === false ? 1 : $page)]).'#sender-'.$this->route('sender')->getKey();
    }
}
