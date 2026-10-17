<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\ChangeProviderStatus;
use App\Enums\ProviderStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ChangeProviderStatusRequest;
use App\Models\ProviderProfile;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class ProviderController extends Controller
{
    public function index(Request $request): View
    {
        $filters = $request->validate(['status' => ['nullable', Rule::enum(ProviderStatus::class)], 'q' => ['nullable', 'string', 'max:100']]);
        $query = ProviderProfile::with('user', 'categories')->latest();
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['q'])) {
            $query->where('business_name', 'like', '%'.$filters['q'].'%');
        }

        return view('admin.providers', ['profiles' => $query->paginate(12)->withQueryString()]);
    }

    public function update(ChangeProviderStatusRequest $request, ProviderProfile $profile, ChangeProviderStatus $change): RedirectResponse
    {
        $change->handle($request->user(), $profile, ProviderStatus::from($request->validated('status')));

        return to_route('admin.providers.index')->with('status', 'Professional status updated.');
    }
}
