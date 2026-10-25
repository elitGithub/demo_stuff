<?php

namespace App\Http\Controllers;

use App\Data\SandboxContext;
use App\Http\Requests\PortfolioRequest;
use App\Http\Requests\RemovePortfolioRequest;
use App\Models\PortfolioImage;
use App\Models\Registry\SandboxFile;
use App\Services\PortfolioService;
use App\Services\StylistService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\Response;

class PortfolioController extends Controller
{
    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @return View
     */
    public function index(Request $request, StylistService $stylists): View
    {
        abort_unless(Validator::make($request->query(), ['page' => ['sometimes', 'integer', 'between:1,10000']])->passes(), 422, 'Choose a valid portfolio page.');
        $profile = $stylists->profile($request->user());

        return view('stylist.portfolio', ['profile' => $profile, 'images' => $profile->portfolioImages()->orderBy('position')->orderBy('id')->paginate(config('demo.pagination'))->withQueryString(), 'uploadCount' => SandboxFile::query()->where('sandbox_digest', app(SandboxContext::class)->digest)->count(), 'savedImage' => $request->session()->has('saved_portfolio_image') ? $profile->portfolioImages()->find($request->session()->get('saved_portfolio_image')) : null]);
    }

    /**
     * @param  PortfolioRequest  $request
     * @param  PortfolioService  $portfolio
     * @param  SandboxContext  $context
     * @return RedirectResponse
     */
    public function store(PortfolioRequest $request, PortfolioService $portfolio, SandboxContext $context): RedirectResponse
    {
        $image = $portfolio->store($request->user(), $context, $request->inputData());

        return redirect()->route('stylist.portfolio.index')->withFragment('save-result')->with('status', 'Your image is saved.')->with('saved_portfolio_image', $image->id);
    }

    /**
     * @param  RemovePortfolioRequest  $request
     * @param  PortfolioService  $portfolio
     * @param  SandboxContext  $context
     * @param  int  $image
     * @return RedirectResponse
     */
    public function destroy(RemovePortfolioRequest $request, PortfolioService $portfolio, SandboxContext $context, int $image): RedirectResponse
    {
        $portfolio->remove($request->user(), $context, PortfolioImage::query()->findOrFail($image));

        return redirect()->route('stylist.portfolio.index')->withFragment('save-result')->with('status', 'Your image was removed from your portfolio.');
    }

    /**
     * @param  Request  $request
     * @param  PortfolioService  $portfolio
     * @param  SandboxContext  $context
     * @param  int  $image
     * @return Response
     */
    public function show(Request $request, PortfolioService $portfolio, SandboxContext $context, int $image): Response
    {
        return $portfolio->read($request->user(), $context, PortfolioImage::query()->findOrFail($image));
    }
}
