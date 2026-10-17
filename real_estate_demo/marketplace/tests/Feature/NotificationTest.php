<?php

namespace Tests\Feature;

use App\Notifications\MarketplaceNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class NotificationTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_notifications_are_visible_and_mutable_only_by_their_owner(): void
    {
        $owner = $this->customer();
        $other = $this->customer();
        $owner->notify(new MarketplaceNotification('New activity', 'A request changed.', 'dashboard'));
        $notification = $owner->notifications()->sole();

        $this->actingAs($other)->get('/notifications')->assertOk()->assertDontSee('A request changed.');
        $this->post("/notifications/{$notification->id}/read")->assertNotFound();
        self::assertNull($notification->fresh()->read_at);
        $this->actingAs($owner)->get('/notifications')->assertOk()->assertSee('A request changed.');
        self::assertNull($notification->fresh()->read_at);
        $this->post("/notifications/{$notification->id}/read")->assertRedirect();
        self::assertNotNull($notification->fresh()->read_at);
    }

    public function test_notification_links_are_application_owned_and_copy_is_escaped(): void
    {
        $owner = $this->customer();
        $owner->notify(new MarketplaceNotification('<script>bad()</script>', 'Visible update', 'https://evil.example/'));

        $this->actingAs($owner)->get('/notifications')->assertOk()
            ->assertSee('&lt;script&gt;', false)->assertDontSee('<script>bad()</script>', false)
            ->assertDontSee('https://evil.example/');
    }

    public function test_read_only_demo_does_not_mark_notifications_read(): void
    {
        $owner = $this->customer();
        $owner->notify(new MarketplaceNotification('Activity', 'Sample update', 'dashboard'));
        $notification = $owner->notifications()->sole();
        config(['demo.read_only' => true]);

        $this->actingAs($owner)->post("/notifications/{$notification->id}/read")->assertForbidden();
        self::assertNull($notification->fresh()->read_at);
    }
}
