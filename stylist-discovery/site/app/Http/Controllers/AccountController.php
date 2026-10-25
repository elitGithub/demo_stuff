<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateNameRequest;
use App\Services\AccountService;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

class AccountController extends Controller
{
    /**
     * @return View
     */
    public function edit(): View
    {
        return view('account.edit');
    }

    /**
     * @param  UpdateNameRequest  $request
     * @param  AccountService  $accounts
     * @return RedirectResponse
     */
    public function update(UpdateNameRequest $request, AccountService $accounts): RedirectResponse
    {
        $accounts->updateName($request->user(), $request->validated('name'));

        return redirect()->route('account.edit')->with('status', 'Your name has been saved.');
    }
}
