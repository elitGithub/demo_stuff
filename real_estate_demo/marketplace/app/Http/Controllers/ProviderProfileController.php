<?php

namespace App\Http\Controllers;

use App\Actions\Accounts\UpdateProviderProfile;
use App\Http\Requests\UpdateProviderProfileRequest;
use App\Models\Category;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class ProviderProfileController extends Controller
{
    public function edit(Request $request): View
    {
        return view('professional.profile', [
            'profile' => $request->user()->profile()->firstOrFail(),
            'categories' => Category::where('is_active', true)->orderBy('name')->get(),
        ]);
    }

    public function update(UpdateProviderProfileRequest $request, UpdateProviderProfile $update): RedirectResponse
    {
        $update->handle($request->user(), $request->validated());

        return to_route('profile.edit')->with('status', 'Your profile has been updated.');
    }
}
