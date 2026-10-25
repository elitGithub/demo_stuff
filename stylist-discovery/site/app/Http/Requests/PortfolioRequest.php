<?php

namespace App\Http\Requests;

use App\Data\PortfolioInput;
use App\Enums\AccountRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class PortfolioRequest extends FormRequest
{
    /**
     * @return bool
     */
    public function authorize(): bool
    {
        return $this->user()->hasRole(AccountRole::Stylist);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'image' => ['required', 'file', 'max:5120'],
            'caption' => ['required', 'string', 'max:160', 'not_regex:/[<>]/u'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['image.required' => 'Choose an image to add.', 'image.max' => 'Choose an image smaller than 5 MB.', 'image.uploaded' => 'This image could not be uploaded. Choose an image smaller than 5 MB.', 'caption.required' => 'Add a short caption for your image.'];
    }

    /**
     * @return void
     */
    protected function prepareForValidation(): void
    {
        if (array_diff(array_keys($this->all()), ['_token', '_actor_context', 'image', 'caption']) !== []) {
            throw ValidationException::withMessages(['form' => 'This form contains unsupported fields.']);
        }
    }

    /**
     * @return PortfolioInput
     */
    public function inputData(): PortfolioInput
    {
        return new PortfolioInput(image: $this->file('image'), caption: $this->validated('caption'));
    }
}
