<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class InboxRequest extends FormRequest
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
            'label' => ['sometimes', 'required', 'string', 'in:inbox,sent,all'],
            'page' => ['sometimes', 'required', 'integer', 'min:1'],
        ];
    }

    /**
     * @return string
     */
    protected function getRedirectUrl(): string
    {
        return route('inbox');
    }
}
