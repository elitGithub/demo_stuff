<?php

namespace App\Http\Requests;

use App\Enums\Role;
use App\Rules\MoneyAmount;
use Illuminate\Foundation\Http\FormRequest;

class StoreQuoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->role === Role::Provider;
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', new MoneyAmount(100)],
            'scope' => ['required', 'string', 'max:5000'],
            'available_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:'.now(config('marketplace.timezone'))->toDateString()],
            'provider_id' => ['prohibited'], 'service_request_id' => ['prohibited'],
            'status' => ['prohibited'], 'amount_cents' => ['prohibited'],
        ];
    }
}
