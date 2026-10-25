<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Http\Requests\SwitchRoleRequest;
use App\Services\AccountService;
use Illuminate\Http\RedirectResponse;

class RoleController extends Controller
{
    /**
     * @param  SwitchRoleRequest  $request
     * @param  AccountService  $accounts
     * @return RedirectResponse
     */
    public function update(SwitchRoleRequest $request, AccountService $accounts): RedirectResponse
    {
        $actor = $accounts->switchRole(AccountRole::from($request->validated('role')));

        return redirect()->route($actor->hasRole(AccountRole::Admin) ? 'admin.index' : 'workspace.index')->with('status', 'You are exploring as '.$actor->role->label().'.');
    }
}
