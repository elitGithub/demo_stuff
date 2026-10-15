<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\View\View;

class ProfileController extends Controller
{
    public function edit(): View
    {
        return view('workspace.profile');
    }

    public function update(Request $request): RedirectResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => 'required|string|max:120', 'email' => ['required', 'email', 'max:255', Rule::unique('users')->ignore($user->id)],
            'current_password' => 'required|current_password', 'password' => ['nullable', 'confirmed', Password::min(12)],
        ]);
        unset($data['current_password']);
        if (empty($data['password'])) {
            unset($data['password']);
        }
        $user->update($data);
        $request->session()->regenerate();

        return back()->with('success', 'Your account has been updated.');
    }
}
