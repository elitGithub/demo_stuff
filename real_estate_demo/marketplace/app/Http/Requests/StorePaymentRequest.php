<?php

namespace App\Http\Requests;

use App\Models\Payment;
use Illuminate\Foundation\Http\FormRequest;

class StorePaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', [Payment::class, $this->route('serviceRequest')]);
    }

    public function rules(): array
    {
        return ['simulation_acknowledged' => ['required', 'accepted']];
    }
}
