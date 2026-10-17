<?php

namespace App\Http\Controllers;

use App\Actions\Senders\AddTrackedSender;
use App\Actions\Senders\DeactivateTrackedSender;
use App\Actions\Senders\DeleteTrackedSender;
use App\Actions\Senders\ReactivateTrackedSender;
use App\Actions\Senders\RenameTrackedSender;
use App\Exceptions\SenderHasCases;
use App\Http\Requests\StoreTrackedSenderRequest;
use App\Http\Requests\UpdateTrackedSenderRequest;
use App\Models\TrackedSender;
use App\Queries\TrackedSenderListQuery;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class TrackedSenderController extends Controller
{
    /**
     * @param  StoreTrackedSenderRequest  $request
     * @param  AddTrackedSender  $add
     * @return RedirectResponse
     *
     * @throws ValidationException
     */
    public function store(StoreTrackedSenderRequest $request, AddTrackedSender $add): RedirectResponse
    {
        try {
            $add(emailHeader: $request->validated('email'), name: $request->validated('name'), label: $request->validated('label'));
        } catch (ValidationException $exception) {
            $exception->errorBag = 'addSender';
            $exception->redirectTo = route('settings').'#add-sender';

            throw $exception;
        }

        return to_route('settings')->withFragment('tracked-senders')->with('toast', 'Sender added. Existing inbox mail has been checked for cases.');
    }

    /**
     * @param  UpdateTrackedSenderRequest  $request
     * @param  TrackedSender  $sender
     * @param  RenameTrackedSender  $rename
     * @param  TrackedSenderListQuery  $senders
     * @return RedirectResponse
     */
    public function update(UpdateTrackedSenderRequest $request, TrackedSender $sender, RenameTrackedSender $rename, TrackedSenderListQuery $senders): RedirectResponse
    {
        $updated = $rename(sender: $sender, name: $request->validated('name'), label: $request->validated('label'));

        return to_route('settings', ['page' => $senders->pageFor($updated)])->withFragment('sender-'.$updated->id)->with('toast', 'Sender details saved.');
    }

    /**
     * @param  Request  $request
     * @param  TrackedSender  $sender
     * @param  DeactivateTrackedSender  $deactivate
     * @return RedirectResponse
     */
    public function deactivate(Request $request, TrackedSender $sender, DeactivateTrackedSender $deactivate): RedirectResponse
    {
        $deactivate(sender: $sender);

        return to_route('settings', ['page' => max(1, $request->integer('page', 1))])->withFragment('sender-'.$sender->id)->with('toast', 'Sender deactivated. Existing cases remain available.');
    }

    /**
     * @param  Request  $request
     * @param  TrackedSender  $sender
     * @param  ReactivateTrackedSender  $reactivate
     * @return RedirectResponse
     */
    public function reactivate(Request $request, TrackedSender $sender, ReactivateTrackedSender $reactivate): RedirectResponse
    {
        $reactivate(sender: $sender);

        return to_route('settings', ['page' => max(1, $request->integer('page', 1))])->withFragment('sender-'.$sender->id)->with('toast', 'Sender reactivated. Existing inbox mail has been checked for cases.');
    }

    /**
     * @param  TrackedSender  $sender
     * @param  DeleteTrackedSender  $delete
     * @return RedirectResponse
     */
    public function destroy(TrackedSender $sender, DeleteTrackedSender $delete): RedirectResponse
    {
        try {
            $delete(sender: $sender);
        } catch (SenderHasCases $exception) {
            abort(422, $exception->getMessage());
        }

        return to_route('settings')->withFragment('tracked-senders')->with('toast', 'Sender deleted.');
    }
}
