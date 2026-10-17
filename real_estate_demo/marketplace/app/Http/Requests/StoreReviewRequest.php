<?php

namespace App\Http\Requests;

use App\Models\Review;
use Illuminate\Foundation\Http\FormRequest;

class StoreReviewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', [Review::class, $this->route('serviceRequest')]);
    }

    public function rules(): array
    {
        return [
            'rating' => ['required', 'integer', 'between:1,5'],
            'body' => ['required', 'string', 'max:2000'],
            'provider_id' => ['prohibited'], 'customer_id' => ['prohibited'], 'service_request_id' => ['prohibited'],
        ];
    }
}
