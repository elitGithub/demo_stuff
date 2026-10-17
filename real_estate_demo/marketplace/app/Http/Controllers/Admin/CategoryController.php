<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\SaveCategory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\SaveCategoryRequest;
use App\Models\Category;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

class CategoryController extends Controller
{
    public function index(): View
    {
        return view('admin.categories', ['categories' => Category::withCount('requests')->orderBy('name')->get()]);
    }

    public function store(SaveCategoryRequest $request, SaveCategory $save): RedirectResponse
    {
        $save->handle($request->user(), $request->validated());

        return to_route('admin.categories.index')->with('status', 'Service category created.');
    }

    public function update(SaveCategoryRequest $request, Category $category, SaveCategory $save): RedirectResponse
    {
        $save->handle($request->user(), $request->validated(), $category);

        return to_route('admin.categories.index')->with('status', 'Service category updated.');
    }
}
