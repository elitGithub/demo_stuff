<?php

namespace App\Http\Requests;

use App\Models\ServiceRequest;
use App\Rules\DecodableImage;
use App\Rules\MoneyAmount;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreServiceRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', ServiceRequest::class) ?? false;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:120'],
            'description' => ['required', 'string', 'max:5000'],
            'category_id' => ['required', 'integer', Rule::exists('categories', 'id')->where('is_active', true)],
            'service_area' => ['required', Rule::in(config('marketplace.service_areas'))],
            'street_address' => ['required', 'string', 'max:255'],
            'preferred_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:'.now(config('marketplace.timezone'))->toDateString()],
            'budget' => ['nullable', new MoneyAmount],
            'photos' => ['sometimes', 'array', 'max:'.config('marketplace.photo_limit')],
            'photos.*' => ['bail', 'required', 'file', 'image', 'mimes:jpg,jpeg,png,webp',
                'mimetypes:image/jpeg,image/png,image/webp',
                'max:'.config('marketplace.photo_max_kilobytes'),
                'dimensions:max_width=4096,max_height=4096', new DecodableImage],
            'customer_id' => ['prohibited'], 'status' => ['prohibited'],
            'accepted_quote_id' => ['prohibited'], 'budget_cents' => ['prohibited'],
        ];
    }
}
