<?php

namespace App\Http\Requests;

use App\Enums\WorkspaceLayout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ChooseLayoutRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'layout' => ['required', Rule::enum(WorkspaceLayout::class)],
            'intended' => ['nullable', 'string', 'max:4096'],
        ];
    }
}
