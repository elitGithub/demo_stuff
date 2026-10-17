<?php

namespace App\Http\Requests;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProviderProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->role === Role::Provider;
    }

    public function rules(): array
    {
        return [
            'business_name' => ['required', 'string', 'max:120'],
            'bio' => ['required', 'string', 'max:5000'],
            'category_ids' => ['required', 'array', 'min:1', 'max:6'],
            'category_ids.*' => ['required', 'integer', 'distinct', Rule::exists('categories', 'id')->where('is_active', true)],
            'service_areas' => ['required', 'array', 'min:1', 'max:3'],
            'service_areas.*' => ['required', 'string', 'distinct', Rule::in(config('marketplace.service_areas'))],
            'status' => ['prohibited'], 'user_id' => ['prohibited'],
            'demo_key' => ['prohibited'], 'slug' => ['prohibited'], 'role' => ['prohibited'],
        ];
    }
}
