<?php

namespace App\Http\Controllers;

use App\Models\StudioSetting;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class ContentController extends Controller
{
    public function edit(): View
    {
        Gate::authorize('manage-studio');
        $content = collect(StudioSetting::DEFAULTS)->mapWithKeys(fn ($default, $key) => [$key => config('studio.'.$key, $default)])->all();

        return view('outreach.content', compact('content'));
    }

    public function update(Request $request): RedirectResponse
    {
        Gate::authorize('manage-studio');
        $data = $request->validate([
            'name' => 'required|string|max:80', 'hero_title' => 'required|string|max:120', 'hero_subtitle' => 'required|string|max:500',
            'about_title' => 'required|string|max:120', 'about_body' => 'required|string|max:3000',
            'address' => 'required|string|max:300', 'phone' => 'required|string|max:40',
            'contact_email' => 'required|email|max:200', 'opening_hours' => 'required|string|max:200',
        ]);
        DB::transaction(function () use ($data) {
            foreach ($data as $key => $value) {
                StudioSetting::updateOrCreate(['key' => $key], ['value' => $value]);
            }
        }, 5);

        return back()->with('success', 'Website text saved.');
    }
}
