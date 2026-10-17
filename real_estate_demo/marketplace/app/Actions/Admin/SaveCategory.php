<?php

namespace App\Actions\Admin;

use App\Enums\Role;
use App\Models\Category;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SaveCategory
{
    public function handle(User $actor, array $validated, ?Category $category = null): Category
    {
        if ($actor->role !== Role::Admin) {
            throw new AuthorizationException;
        }
        $category ??= new Category;
        $category->fill(collect($validated)->only(['name', 'description', 'icon', 'is_active'])->all());
        if (! $category->exists) {
            $slug = Str::slug($validated['name']);
            if ($slug === '' || Category::where('slug', $slug)->exists()) {
                throw ValidationException::withMessages(['name' => 'Choose a unique service name containing letters or numbers.']);
            }
            $category->slug = $slug;
        }
        try {
            $category->save();
        } catch (UniqueConstraintViolationException $exception) {
            throw ValidationException::withMessages(['name' => 'A service with this name already exists.']);
        }

        return $category;
    }
}
