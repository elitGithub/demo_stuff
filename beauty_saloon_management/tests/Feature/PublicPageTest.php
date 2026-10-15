<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_public_website_renders_before_demo_seeding(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }
}
