<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class OwnerSeeder extends Seeder
{
    /**
     * @return void
     */
    public function run(): void
    {
        User::query()->create([
            'name' => config('casefile.owner.name'),
            'email' => config('casefile.owner.email'),
        ]);
    }
}
