<?php

namespace App\Http\Requests;

use App\Data\DiscoveryFilter;
use App\Enums\DiscoverySort;
use App\Services\DiscoveryService;
use Closure;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Validation\Rule;

class DiscoveryRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'search' => ['nullable', 'string', 'max:80'],
            'country' => ['nullable', 'string', Rule::in(array_column(config('demo.locations'), 'country_code'))],
            'city' => ['nullable', 'string', Rule::in(array_keys(config('demo.locations')))],
            'specialty' => ['nullable', 'integer', Rule::exists('visitor.specialties', 'id')->where('enabled', true)],
            'minimum' => ['nullable', 'string', 'regex:/\A(?:[0-9]{1,3}(?:\.[0-9]{1,2})?|1000(?:\.0{1,2})?)\z/'],
            'maximum' => ['nullable', 'string', 'regex:/\A(?:[0-9]{1,3}(?:\.[0-9]{1,2})?|1000(?:\.0{1,2})?)\z/'],
            'sort' => ['nullable', Rule::enum(DiscoverySort::class)],
            'page' => ['nullable', 'integer', 'between:1,10000'],
            'services_page' => ['nullable', 'integer', 'between:1,10000'],
            'portfolio_page' => ['nullable', 'integer', 'between:1,10000'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'minimum.regex' => 'Enter a minimum price from €0 to €1,000 with up to two decimal places.',
            'maximum.regex' => 'Enter a maximum price from €0 to €1,000 with up to two decimal places.',
            'minimum.string' => 'Enter one minimum price.',
            'maximum.string' => 'Enter one maximum price.',
        ];
    }

    /**
     * @return DiscoveryFilter
     */
    public function inputData(): DiscoveryFilter
    {
        return new DiscoveryFilter(
            search: $this->validated('search'),
            countryCode: $this->validated('country'),
            cityCode: $this->validated('city'),
            specialtyId: $this->filled('specialty') ? (int) $this->validated('specialty') : null,
            minimumCents: $this->priceCents($this->validated('minimum')),
            maximumCents: $this->priceCents($this->validated('maximum')),
            sort: DiscoverySort::from($this->validated('sort') ?? DiscoverySort::Name->value),
            page: (int) ($this->validated('page') ?? 1),
        );
    }

    /**
     * @return array<string, string>
     */
    public function filterValues(): array
    {
        $values = [];
        foreach (['search' => 80, 'country' => 2, 'city' => 20, 'specialty' => 10, 'minimum' => 8, 'maximum' => 8, 'sort' => 24] as $field => $maximum) {
            $value = $this->input($field);
            $values[$field] = is_string($value) ? mb_substr($value, 0, $maximum) : '';
        }

        return $values;
    }

    /**
     * @return array<Closure>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isEmpty() && $this->filled('minimum') && $this->filled('maximum') && $this->priceCents($this->input('minimum')) > $this->priceCents($this->input('maximum'))) {
                $validator->errors()->add('maximum', 'The maximum price must be at least the minimum price.');
            }
        }];
    }

    /**
     * @param  ?string  $amount
     * @return ?int
     */
    protected function priceCents(?string $amount): ?int
    {
        if ($amount === null) {
            return null;
        }
        $parts = explode('.', $amount);

        return ((int) $parts[0] * 100) + (int) str_pad($parts[1] ?? '', 2, '0');
    }

    /**
     * @param  Validator  $validator
     * @return never
     *
     * @throws HttpResponseException
     */
    protected function failedValidation(Validator $validator): never
    {
        if ($this->expectsJson()) {
            throw new HttpResponseException(response()->json(['message' => 'Please check your filters.', 'errors' => $validator->errors()], 422));
        }

        $catalogue = app(DiscoveryService::class)->catalogue();

        throw new HttpResponseException(response()->view('discovery.invalid', [
            'profiles' => null,
            'values' => $this->filterValues(),
            'specialties' => $catalogue->specialties,
            'demoStylist' => $catalogue->demoStylist,
            'errors' => (new ViewErrorBag)->put('default', $validator->errors()),
        ], 422));
    }
}
