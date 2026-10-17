<?php

namespace App\Http\Controllers;

use App\Enums\ProviderStatus;
use App\Models\Category;
use App\Models\ProviderProfile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class DiscoveryController extends Controller
{
    public function home(): View
    {
        return view('home', [
            'categories' => Category::where('is_active', true)->orderBy('id')->get(),
            'professionals' => $this->profiles()->limit(3)->get(),
        ]);
    }

    public function categories(): View
    {
        return view('categories.index', ['categories' => Category::where('is_active', true)->orderBy('name')->get()]);
    }

    public function professionals(Request $request): View
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', 'integer', 'exists:categories,id'],
            'area' => ['nullable', Rule::in(config('marketplace.service_areas'))],
        ]);
        $profiles = $this->profiles()
            ->when($filters['q'] ?? null, fn (Builder $query, string $q) => $query->where('business_name', 'like', '%'.$q.'%'))
            ->when($filters['category'] ?? null, fn (Builder $query, $id) => $query
                ->whereHas('categories', fn (Builder $categories) => $categories->where('categories.id', $id)->where('is_active', true)))
            ->when($filters['area'] ?? null, fn (Builder $query, string $area) => $query->whereJsonContains('service_areas', $area))
            ->paginate(12)->withQueryString();

        return view('professionals.index', [
            'professionals' => $profiles,
            'categories' => Category::where('is_active', true)->orderBy('name')->get(),
        ]);
    }

    public function show(ProviderProfile $profile): View
    {
        abort_unless($profile->status === ProviderStatus::Approved, 404);
        $profile->load(['categories', 'user' => fn ($query) => $query->withAvg('receivedReviews', 'rating')->withCount('receivedReviews')]);
        $reviews = $profile->user->receivedReviews()->with('customer')->latest()->paginate(8);

        return view('professionals.show', compact('profile', 'reviews'));
    }

    private function profiles(): Builder
    {
        return ProviderProfile::where('status', ProviderStatus::Approved)
            ->with(['categories', 'user' => fn ($query) => $query->withAvg('receivedReviews', 'rating')->withCount('receivedReviews')])
            ->orderBy('business_name');
    }
}
