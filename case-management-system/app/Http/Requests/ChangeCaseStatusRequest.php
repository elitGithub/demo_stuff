<?php

namespace App\Http\Requests;

use App\Enums\CaseStatus;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ChangeCaseStatusRequest extends FormRequest
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
            'status' => ['required', Rule::enum(CaseStatus::class)],
            'return_to' => ['sometimes', 'required', Rule::in(['board'])],
            'board' => ['sometimes', 'array:open_page,in_progress_page,closed_page'],
            'board.*' => ['required', 'integer', 'min:1', 'max:2147483647'],
        ];
    }
}
