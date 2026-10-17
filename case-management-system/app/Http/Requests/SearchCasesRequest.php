<?php

namespace App\Http\Requests;

use App\Enums\CaseStatus;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class SearchCasesRequest extends FormRequest
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
        return self::filterRules($this->all());
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public static function filterRules(array $input): array
    {
        $dateRules = ['bail', 'nullable', 'date', 'date_format:Y-m-d'];
        $compareDates = filled($input['from'] ?? null)
            && Validator::make($input, ['from' => $dateRules])->passes();

        return [
            'q' => ['bail', 'nullable', 'string', 'max:200'],
            'status' => ['array'],
            'status.*' => ['bail', Rule::enum(CaseStatus::class)],
            'sender' => ['bail', 'nullable', 'integer', 'exists:tracked_senders,id'],
            'from' => $dateRules,
            'to' => [...$dateRules, Rule::when($compareDates, 'after_or_equal:from')],
            'page' => ['bail', 'nullable', 'integer', 'min:1'],
        ];
    }

    /**
     * @return string
     */
    protected function getRedirectUrl(): string
    {
        return route('search');
    }
}
