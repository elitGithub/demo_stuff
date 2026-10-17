<?php

namespace App\Http\Requests;

use App\Enums\JobStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TransitionJobRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('transition', $this->route('serviceRequest'));
    }

    public function rules(): array
    {
        return ['status' => ['required', Rule::enum(JobStatus::class)]];
    }
}
