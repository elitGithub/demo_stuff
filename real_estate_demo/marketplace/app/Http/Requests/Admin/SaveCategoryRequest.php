<?php

namespace App\Http\Requests\Admin;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === Role::Admin;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'description' => ['required', 'string', 'max:500'],
            'icon' => ['required', Rule::in(['sparkles', 'pipe', 'bolt', 'brush', 'leaf', 'wrench'])],
            'is_active' => ['required', 'boolean'],
            'slug' => ['prohibited'],
        ];
    }
}
