<?php

namespace App\Http\Controllers;

use App\Enums\WorkspaceLayout;
use App\Layouts\LayoutResolver;
use App\Queries\BoardQuery;
use App\Queries\CaseListQuery;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    /**
     * @param  Request  $request
     * @param  LayoutResolver  $layouts
     * @return View
     */
    public function index(Request $request, LayoutResolver $layouts): View
    {
        $layout = $layouts->fromRequest($request) ?? WorkspaceLayout::default();

        return view($layouts->viewName($layout, 'index'), $layout === WorkspaceLayout::Board
            ? ['board' => BoardQuery::context($request)]
            : ['list' => CaseListQuery::context($request)]);
    }
}
