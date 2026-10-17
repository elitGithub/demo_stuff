<?php

namespace App\Http\Requests;

class UpdateQuoteRequest extends StoreQuoteRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->route('quote')) ?? false;
    }

    public function rules(): array
    {
        return array_merge(parent::rules(), ['version' => ['required', 'integer', 'min:1']]);
    }
}
