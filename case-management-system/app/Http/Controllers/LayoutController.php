<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChooseLayoutRequest;
use App\Layouts\LayoutResolver;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class LayoutController extends Controller
{
    /**
     * @param  Request  $request
     * @param  LayoutResolver  $layouts
     * @return View
     */
    public function picker(Request $request, LayoutResolver $layouts): View
    {
        return view('workspace.picker', ['intended' => $layouts->redirectTarget($request->session()->get('layout.intended'))]);
    }

    /**
     * @param  ChooseLayoutRequest  $request
     * @param  LayoutResolver  $layouts
     * @return RedirectResponse
     */
    public function choose(ChooseLayoutRequest $request, LayoutResolver $layouts): RedirectResponse
    {
        $intended = $request->validated('intended') ?? $request->session()->get('layout.intended');
        $request->session()->forget('layout.intended');

        return redirect()->to($layouts->redirectTarget($intended))->withCookie(cookie(
            name: config('casefile.layout.cookie'),
            value: $request->validated('layout'),
            minutes: 60 * 24 * 365,
            path: $layouts->cookiePath(),
            secure: $request->isSecure(),
            httpOnly: true,
            sameSite: 'lax',
        ));
    }
}
