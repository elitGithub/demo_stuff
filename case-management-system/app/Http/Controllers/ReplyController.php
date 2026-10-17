<?php

namespace App\Http\Controllers;

use App\Actions\Cases\SendCaseReply;
use App\Enums\CasefileMode;
use App\Http\Requests\StoreReplyRequest;
use App\Models\CaseRecord;
use Illuminate\Http\RedirectResponse;

class ReplyController extends Controller
{
    /**
     * @param  StoreReplyRequest  $request
     * @param  CaseRecord  $case
     * @param  SendCaseReply  $send
     * @return RedirectResponse
     */
    public function store(StoreReplyRequest $request, CaseRecord $case, SendCaseReply $send): RedirectResponse
    {
        $send(case: $case, bodyText: $request->validated('body'));
        $response = to_route('cases.show', $case)->withFragment('thread-end')->with('toast', 'Reply sent via Gmail.');

        if (CasefileMode::current()->demoControlsEnabled()) {
            $response->with('auto_reply_case', $case->number);
        }

        return $response;
    }
}
