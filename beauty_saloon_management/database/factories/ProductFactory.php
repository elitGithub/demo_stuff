<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class ProductFactory extends Factory
{
    public function definition(): array
    {
        return ['sku' => fake()->unique()->bothify('CARE-####??'), 'name' => 'Daily shampoo', 'description' => 'Gentle daily care.', 'price' => 1800, 'stock' => 0, 'active' => true];
    }
}
