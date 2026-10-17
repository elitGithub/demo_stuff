<?php

namespace App\Http\Controllers;

use App\Enums\ProviderStatus;
use App\Models\Category;
use App\Queries\ProviderOpportunities;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class OpportunityController extends Controller
{
    public function __invoke(Request $request, ProviderOpportunities $opportunities): View
    {
        abort_unless($request->user()->profile?->status === ProviderStatus::Approved, 403,
            'Your profile needs approval before you can respond to opportunities.');
        $filters = $request->validate([
            'category' => ['nullable', 'integer', 'exists:categories,id'],
            'area' => ['nullable', Rule::in(config('marketplace.service_areas'))],
        ]);
        $jobs = $opportunities->forUser($request->user())->with('category')->withCount('quotes')
            ->when($filters['category'] ?? null, fn ($query, $id) => $query->where('category_id', $id))
            ->when($filters['area'] ?? null, fn ($query, $area) => $query->where('service_area', $area))
            ->latest()->paginate(10)->withQueryString();

        return view('professional.opportunities', [
            'jobs' => $jobs, 'categories' => Category::where('is_active', true)->orderBy('name')->get(),
        ]);
    }
}
