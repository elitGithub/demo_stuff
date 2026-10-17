<?php

namespace App\Http\Controllers;

use App\Enums\CasefileMode;
use App\Exceptions\SandboxLimitReached;
use App\Sandbox\SandboxStore;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

class SandboxResetController extends Controller
{
    /**
     * @param  Request  $request
     * @param  SandboxStore  $sandboxes
     * @return RedirectResponse
     *
     * @throws NotFoundHttpException
     * @throws SandboxLimitReached
     * @throws LockTimeoutException
     * @throws RuntimeException
     * @throws Throwable
     */
    public function __invoke(Request $request, SandboxStore $sandboxes): RedirectResponse
    {
        abort_unless(CasefileMode::current()->usesSandboxes(), 404);

        $sandboxes->start($request->session(), $request->ip());

        return redirect()->route('home')->with('status', SandboxStore::RESET_NOTICE);
    }
}
