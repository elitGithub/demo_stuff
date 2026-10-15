<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class MembershipPlanFactory extends Factory
{
    public function definition(): array
    {
        return ['name' => fake()->unique()->bothify('Care plan ####??'), 'benefits' => 'One personal care consultation during the term.', 'price' => 4500, 'duration_days' => 30, 'active' => true];
    }
}
