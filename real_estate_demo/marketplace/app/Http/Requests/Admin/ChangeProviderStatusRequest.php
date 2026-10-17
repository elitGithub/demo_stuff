<?php

namespace App\Http\Requests\Admin;

use App\Enums\ProviderStatus;
use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ChangeProviderStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === Role::Admin;
    }

    public function rules(): array
    {
        return ['status' => ['required', Rule::enum(ProviderStatus::class)]];
    }
}
