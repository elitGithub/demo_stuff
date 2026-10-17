<?php

namespace Tests\Feature;

use App\Demo\InboxScript;
use App\Models\CaseRecord;
use App\Models\User;
use App\Notifications\CaseCreated;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->withCookie(config('casefile.layout.cookie'), 'desk');
        $this->seed();
        $this->withSession([])->withCookie(config('session.cookie'), session()->getId())->withCredentials();
    }

    /**
     * @return void
     */
    public function test_created_intake_bell_and_list_show_one_new_unread_then_mark_read_zeroes_it(): void
    {
        $owner = User::query()->sole();
        $this->assertSame(2, $owner->unreadNotifications()->count());
        $owner->unreadNotifications()->update(['read_at' => CarbonImmutable::now()]);
        $report = app(InboxScript::class)->deliverNext();
        $this->actingAs($owner)->get(route('home'))->assertOk()->assertSee('data-unread-count="1"', false)->assertSee('Notifications: 1 unread');
        $this->get(route('notifications'))->assertOk()->assertSee($report->outcome->case->number)->assertSee($report->outcome->case->subject)->assertSee('Unread');
        $this->post(route('notifications.read'))->assertRedirect(route('notifications'))->assertSessionHas('toast', 'All notifications marked as read.');
        $this->assertSame(0, $owner->unreadNotifications()->count());
        $this->get(route('notifications'))->assertOk()->assertSee('data-unread-count="0"', false)->assertSee($report->outcome->case->subject)->assertDontSee('notification-read-label', false);
    }

    /**
     * @return void
     */
    public function test_notifications_and_mark_read_are_scoped_to_authenticated_principal(): void
    {
        $owner = User::query()->sole();
        $other = User::factory()->create(['email' => 'other@casefile.example']);
        $case = CaseRecord::factory()->create(['subject' => 'Private other user update']);
        $other->notify(new CaseCreated(case: $case));
        $this->actingAs($owner)->get(route('notifications'))->assertOk()->assertDontSee('Private other user update')->assertDontSee($case->number);
        $this->post(route('notifications.read'), ['user_id' => $other->id])->assertRedirect();
        $this->assertSame(0, $owner->unreadNotifications()->count());
        $this->assertSame(1, $other->unreadNotifications()->count());
        $this->actingAs($other)->get(route('notifications'))->assertOk()->assertSee('Private other user update')->assertSee('data-unread-count="1"', false);
    }

    /**
     * @return void
     */
    public function test_newest_first_pagination_and_escaped_subjects(): void
    {
        $owner = User::query()->sole();

        for ($position = 1; $position <= 25; $position++) {
            $notificationCase = CaseRecord::factory()->create(['subject' => sprintf('Update %02d <script>bad()</script>', $position)]);
            $owner->notify(new CaseCreated(case: $notificationCase));
            $owner->notifications()->where('data->case_id', $notificationCase->id)->update(['created_at' => CarbonImmutable::now()->addMinutes($position)]);
        }

        $response = $this->actingAs($owner)->get(route('notifications'))->assertOk()->assertSeeInOrder(['Update 25', 'Update 24', 'Update 06'])->assertDontSee('Update 05')
            ->assertSee('&lt;script&gt;bad()&lt;/script&gt;', false)->assertDontSee('<script>bad()</script>', false)->assertSee('Page 1 of 2')->assertSee('rel="next"', false);
        $this->assertCount(20, $response->viewData('notifications')->items());
        $pageTwo = $this->get(route('notifications', ['page' => 2]))->assertOk()->assertSee('Update 05')->assertSee('Update 01')->assertDontSee('Update 06')->assertSee('Page 2 of 2');
        $this->assertCount(7, $pageTwo->viewData('notifications')->items());
    }

    /**
     * @return void
     */
    public function test_notification_routes_require_authentication_csrf_and_correct_methods(): void
    {
        $this->get(route('notifications'))->assertRedirect('/sign-in');
        $this->post(route('notifications.read'))->assertRedirect('/sign-in');
        $owner = User::query()->sole();
        $this->actingAs($owner)->get(route('notifications.read'))->assertStatus(405);
        $this->app['env'] = 'csrf-check';
        $this->withSession(['_token' => 'expected-token'])->post(route('notifications.read'))->assertStatus(419);
        $this->assertSame(2, $owner->unreadNotifications()->count());
    }

    /**
     * @return void
     */
    public function test_mark_read_is_idempotent_and_keeps_original_read_timestamps(): void
    {
        $owner = User::query()->sole();
        $this->actingAs($owner)->post(route('notifications.read'))->assertRedirect();
        $original = $owner->notifications()->pluck('read_at', 'id')->all();
        $this->travel(1)->hour();
        $this->post(route('notifications.read'))->assertRedirect();
        $this->assertEquals($original, $owner->notifications()->pluck('read_at', 'id')->all());
        $this->travelBack();
    }
}
