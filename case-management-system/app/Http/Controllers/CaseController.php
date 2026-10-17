<?php

namespace App\Http\Controllers;

use App\Actions\Cases\ChangeCaseStatus;
use App\Actions\Cases\UpdateCaseDetails;
use App\Enums\CaseStatus;
use App\Enums\WorkspaceLayout;
use App\Http\Requests\ChangeCaseStatusRequest;
use App\Http\Requests\SearchCasesRequest;
use App\Http\Requests\UpdateCaseDetailsRequest;
use App\Layouts\LayoutResolver;
use App\Models\CaseRecord;
use App\Queries\BoardQuery;
use App\Queries\CaseListQuery;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class CaseController extends Controller
{
    /**
     * @param  Request  $request
     * @param  CaseRecord  $case
     * @param  LayoutResolver  $layouts
     * @return View
     */
    public function show(Request $request, CaseRecord $case, LayoutResolver $layouts): View
    {
        $searchReturnUrl = null;
        $search = $request->query('search');

        if (is_array($search)) {
            $validator = Validator::make($search, SearchCasesRequest::filterRules($search));

            if ($validator->passes()) {
                $searchReturnUrl = route('search', $validator->validated());
            }
        }

        $layout = $layouts->fromRequest($request) ?? WorkspaceLayout::default();

        return view($layouts->viewName($layout, 'show'), [
            'case' => $case->load(['trackedSender', 'messages.attachments', 'events']),
            'list' => CaseListQuery::context($request),
            'searchReturnUrl' => $searchReturnUrl,
        ]);
    }

    /**
     * @param  UpdateCaseDetailsRequest  $request
     * @param  CaseRecord  $case
     * @param  UpdateCaseDetails  $update
     * @return RedirectResponse
     */
    public function update(UpdateCaseDetailsRequest $request, CaseRecord $case, UpdateCaseDetails $update): RedirectResponse
    {
        $update(case: $case, issue: $request->validated('issue'), notes: $request->validated('notes'), status: CaseStatus::from($request->validated('status')));

        return to_route('cases.show', $case)->withFragment('case-details')->with('toast', 'Case details saved.');
    }

    /**
     * @param  ChangeCaseStatusRequest  $request
     * @param  CaseRecord  $case
     * @param  ChangeCaseStatus  $changeStatus
     * @return RedirectResponse
     */
    public function status(ChangeCaseStatusRequest $request, CaseRecord $case, ChangeCaseStatus $changeStatus): RedirectResponse
    {
        $updated = $changeStatus(case: $case, to: CaseStatus::from($request->validated('status')));

        if ($request->validated('return_to') === 'board') {
            $pages = $request->validated('board', []);
            $pages[$updated->status->value.'_page'] = BoardQuery::pageFor($updated);

            return to_route('home', $pages)->withFragment('board-card-'.$updated->number)->with('toast', 'Case '.$updated->status->label().'.');
        }

        return to_route('cases.show', $case)->withFragment('case-heading')->with('toast', 'Case '.$updated->status->label().'.');
    }
}
