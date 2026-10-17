<?php

namespace App\Http\Controllers;

use App\Data\SearchFilters;
use App\Http\Requests\SearchCasesRequest;
use App\Models\TrackedSender;
use App\Search\CaseSearch;
use Illuminate\Contracts\View\View;

class SearchController extends Controller
{
    /**
     * @param  SearchCasesRequest  $request
     * @return View
     */
    public function __invoke(SearchCasesRequest $request): View
    {
        $filters = SearchFilters::fromRequest($request);
        $cases = (new CaseSearch(filters: $filters))->paginate();

        return view('search.index', [
            'filters' => $filters,
            'cases' => $cases,
            'senders' => TrackedSender::query()->orderBy('name')->orderBy('id')->get(),
            'listQuery' => ['search' => [...$filters->parameters(), 'page' => $cases->currentPage()]],
        ]);
    }
}
