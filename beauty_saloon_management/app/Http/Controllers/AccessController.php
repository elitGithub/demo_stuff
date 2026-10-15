<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class AccessController extends Controller
{
    public function index(): View
    {
        return view('workspace.access', ['users' => User::orderBy('name')->get(), 'managers' => User::whereIn('role', ['owner', 'manager'])->where('active', true)->get()]);
    }

    public function save(Request $request, ?User $user = null): RedirectResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:120',
            'email' => ['required', 'email', 'max:255', Rule::unique('users')->ignore($user?->id)],
            'role' => 'required|in:owner,manager,staff', 'active' => 'nullable|boolean',
            'password' => [$user ? 'nullable' : 'required', 'confirmed', Password::min(12)],
            'manager_id' => ['nullable', Rule::exists('users', 'id')->where(fn ($q) => $q->whereIn('role', ['owner', 'manager'])->where('active', true))],
        ]);
        $data['active'] = $request->boolean('active');
        if ($user?->id === $request->user()->id && ($data['role'] !== 'owner' || ! $data['active'])) {
            throw ValidationException::withMessages(['role' => 'Keep your own owner account active. Another owner can change it.']);
        }
        if ($user && (int) ($data['manager_id'] ?? 0) === $user->id) {
            throw ValidationException::withMessages(['manager_id' => 'An account cannot manage itself.']);
        }
        if (empty($data['password'])) {
            unset($data['password']);
        }
        $data['manager_id'] = $data['role'] === 'staff' ? ($data['manager_id'] ?? null) : null;
        $user ??= new User;
        $user->fill($data)->save();
        if ($user->role === 'staff' || ! $user->active) {
            User::where('manager_id', $user->id)->update(['manager_id' => null]);
        }

        return back()->with('success', 'Account saved. Passwords are stored securely; disabled accounts lose access immediately.');
    }
}
