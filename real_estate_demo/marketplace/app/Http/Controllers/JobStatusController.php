<?php

namespace App\Http\Controllers;

use App\Actions\Jobs\CancelJob;
use App\Actions\Jobs\TransitionJob;
use App\Enums\JobStatus;
use App\Http\Requests\TransitionJobRequest;
use App\Models\ServiceRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class JobStatusController extends Controller
{
    public function update(TransitionJobRequest $request, ServiceRequest $serviceRequest, TransitionJob $transition): RedirectResponse
    {
        $transition->handle($request->user(), $serviceRequest, JobStatus::from($request->validated('status')));

        return to_route('requests.show', $serviceRequest)->with('status', 'Job progress updated.');
    }

    public function cancel(Request $request, ServiceRequest $serviceRequest, CancelJob $cancel): RedirectResponse
    {
        $cancel->handle($request->user(), $serviceRequest);

        return to_route('requests.show', $serviceRequest)->with('status', 'Request cancelled.');
    }
}
