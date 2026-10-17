<?php

namespace App\Http\Controllers;

use App\Demo\InboxScript;
use App\Enums\CasefileMode;
use App\Enums\MailboxLabel;
use App\Http\Requests\InboxRequest;
use App\Models\MailboxMessage;
use App\Queries\MailboxListQuery;
use Illuminate\Contracts\View\View;

class InboxController extends Controller
{
    /**
     * @param  InboxRequest  $request
     * @return View
     */
    public function index(InboxRequest $request): View
    {
        $label = $request->validated('label', MailboxLabel::Inbox->value);
        $messages = (new MailboxListQuery(label: MailboxLabel::tryFrom($label)))->paginate();
        $messages->appends(['label' => $label]);

        return view('inbox.index', [
            'messages' => $messages,
            'label' => $label,
            'progress' => CasefileMode::current()->demoControlsEnabled() ? app(InboxScript::class)->progress() : null,
        ]);
    }

    /**
     * @param  InboxRequest  $request
     * @param  MailboxMessage  $message
     * @return View
     */
    public function show(InboxRequest $request, MailboxMessage $message): View
    {
        $message->load(['sender', 'caseMessage.case.trackedSender']);
        $case = $message->caseMessage?->case;

        return view('inbox.show', [
            'message' => $message,
            'label' => $request->validated('label', $message->label->value),
            'case' => $case,
            'sender' => $message->label === MailboxLabel::Sent ? $case?->trackedSender : $message->sender,
            'attachments' => $message->attachments()->orderBy('id')->paginate(25)->appends(['label' => $request->validated('label', $message->label->value)]),
            'progress' => CasefileMode::current()->demoControlsEnabled() ? app(InboxScript::class)->progress() : null,
        ]);
    }
}
