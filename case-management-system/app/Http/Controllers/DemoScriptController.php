<?php

namespace App\Http\Controllers;

use App\Demo\InboxScript;
use App\Http\Requests\DeliverReplyRequest;
use App\Models\CaseRecord;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

class DemoScriptController extends Controller
{
    /**
     * @param  InboxScript  $script
     * @return RedirectResponse
     */
    public function deliverNext(InboxScript $script): RedirectResponse
    {
        return back()->with('status', $script->deliverNext()?->summary ?? 'All scripted messages have been delivered.');
    }

    /**
     * @param  DeliverReplyRequest  $request
     * @param  InboxScript  $script
     * @return RedirectResponse
     */
    public function deliverReply(DeliverReplyRequest $request, InboxScript $script): RedirectResponse
    {
        $number = $request->validated('case');
        $case = $number === null ? null : CaseRecord::query()->where('number', $number)->firstOrFail();

        return back()->with('status', $script->deliverReply(case: $case)?->summary ?? 'No scripted replies are available.');
    }

    /**
     * @param  CaseRecord  $case
     * @param  InboxScript  $script
     * @return JsonResponse
     */
    public function autoReply(CaseRecord $case, InboxScript $script): JsonResponse
    {
        $report = $script->autoReply(case: $case);

        if ($report !== null) {
            session()->flash('toast', $report->summary);
        }

        return response()->json([
            'delivered' => $report !== null,
            'summary' => $report?->summary ?? 'No scripted reply is available.',
        ]);
    }
}
