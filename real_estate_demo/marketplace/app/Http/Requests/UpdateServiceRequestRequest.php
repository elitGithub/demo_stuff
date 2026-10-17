<?php

namespace App\Http\Requests;

class UpdateServiceRequestRequest extends StoreServiceRequestRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->route('serviceRequest')) ?? false;
    }

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['photos.*']);
        $rules['photos'] = ['prohibited'];

        return $rules;
    }
}
