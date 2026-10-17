<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('viewConversation', $this->route('quote')) ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('body'))) {
            $this->merge(['body' => trim($this->input('body'))]);
        }
    }

    public function rules(): array
    {
        return ['body' => ['required', 'string', 'max:2000'],
            'sender_id' => ['prohibited'], 'quote_id' => ['prohibited']];
    }
}
