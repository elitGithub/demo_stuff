<?php

namespace Tests\Feature;

use App\Data\PortfolioInput;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\CheckoutOutcome;
use App\Enums\PaymentKind;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Specialty;
use App\Models\User;
use App\Services\AdminService;
use App\Services\PaymentService;
use App\Services\PortfolioService;
use App\Services\SandboxService;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsBookingRuntime;
use Tests\Support\PortfolioImages;
use Tests\TestCase;

class AdminEligibilityTest extends TestCase
{
    use BuildsBookingRuntime;

    protected User $adminActor;

    protected AdminService $admin;

    /** @return void */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildBookingRuntime();
        $this->profile->update(['biography' => 'A fictional studio for considered cuts.', 'address' => '12 Fictional Lane']);
        $this->adminActor = User::query()->where('role', AccountRole::Admin)->sole();
        $this->admin = app(AdminService::class);
    }

    /** @return iterable<string, array{string, bool}> */
    public static function catalogueChanges(): iterable
    {
        foreach (['specialty', 'profile', 'service', 'all'] as $boundary) {
            foreach ([false, true] as $complete) {
                yield $boundary.($complete ? '-complete' : '-refund') => [$boundary, $complete];
            }
        }
    }

    /** @param string $boundary
     * @param bool $complete
     * @return void */
    #[DataProvider('catalogueChanges')]
    public function test_disabled_catalogue_preserves_existing_obligations(string $boundary, bool $complete): void
    {
        $accepted = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input(), $this->now), $this->now);
        $pending = $this->bookings->request($this->client, $this->input('12:00'), $this->now);
        $snapshot = $accepted->fresh()->only(['service_name', 'price_cents', 'duration_minutes', 'deposit_percent', 'deposit_cents', 'remaining_cents', 'timezone', 'starts_at', 'ends_at']);
        if (in_array($boundary, ['specialty', 'all'], true)) {
            $this->admin->setSpecialty($this->adminActor, $this->service->specialty, false);
        }
        if (in_array($boundary, ['profile', 'all'], true)) {
            $this->admin->suspend($this->adminActor, $this->profile);
        }
        if (in_array($boundary, ['service', 'all'], true)) {
            $this->service->update(['active' => false]);
        }
        $this->assertRejected(fn () => $this->bookings->request($this->client, $this->input('14:00'), $this->now), 409);
        $this->switchTo(AccountRole::Stylist);
        $pendingAcceptanceResponse = $this->post(route('bookings.accept', $pending->id), ['_actor_context' => $this->formContext($this->get('/account'))]);
        $pendingAcceptanceResponse->assertStatus(409);
        $this->admitAccountFixture();
        $this->assertSame(BookingStatus::Requested, $pending->refresh()->status);
        $paidResult = app(PaymentService::class)->checkout($this->client, $accepted, CheckoutOutcome::Succeeded, $this->now);
        $this->assertSame(BookingStatus::Confirmed, $paidResult->booking->status);
        $this->assertEquals($snapshot, $accepted->fresh()->only(array_keys($snapshot)));
        if ($complete) {
            $this->assertSame(BookingStatus::Completed, $this->bookings->complete($this->stylist, $accepted, $accepted->ends_at)->status);
            $this->assertSame(0, $accepted->payments()->where('kind', PaymentKind::Refund)->count());
        } else {
            $this->assertSame(BookingStatus::Cancelled, $this->bookings->cancel($this->client, $accepted, null, $this->now)->status);
            $this->assertSame(500, $accepted->payments()->where('kind', PaymentKind::Refund)->sole()->amount_cents);
        }
        $this->assertSame(500, $accepted->payments()->where('kind', PaymentKind::Deposit)->sole()->amount_cents);
        $this->assertEquals($snapshot, $accepted->fresh()->only(array_keys($snapshot)));
        $this->assertSame(2, Booking::query()->count());
    }

    /** @return void */
    public function test_publication_requires_submission_and_current_completeness_and_is_explicit_after_suspension(): void
    {
        $this->profile->update(['status' => ProfileStatus::Pending]);
        $this->switchTo(AccountRole::Admin);
        $this->admitAccountFixture();
        $this->profile->update(['biography' => '']);
        $review = $this->get(route('admin.application', $this->profile->id))->assertOk()->assertSee('Publish studio');
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $this->formContext($review)])->assertStatus(422)->assertSee('Complete the studio details');
        $this->admitAccountFixture();
        $this->assertSame(ProfileStatus::Pending, $this->profile->refresh()->status);
        $this->profile->update(['biography' => 'Complete fictional biography']);
        $context = $this->formContext($this->get('/account'));
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertRedirect(route('admin.application', $this->profile->id).'#review-result');
        $this->get(route('admin.application', $this->profile->id))->assertOk()->assertSee('Profile published')->assertSee('View in discovery')->assertSee('data-confirm=', false);
        $this->post(route('admin.suspend', $this->profile->id), ['_actor_context' => $context])->assertRedirect();
        $this->get(route('admin.application', $this->profile->id))->assertOk()->assertSee('Restore publication')->assertDontSee('data-confirm=', false);
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertRedirect();
        $this->admitAccountFixture();
        $this->assertSame(ProfileStatus::Published, $this->profile->refresh()->status);
        $this->profile->update(['status' => ProfileStatus::Draft]);
        $this->assertRejected(fn () => $this->admin->publish($this->adminActor, $this->profile), 409);
    }

    /** @return void */
    public function test_current_service_specialty_and_hours_are_required_on_publish(): void
    {
        $this->profile->update(['status' => ProfileStatus::Pending]);
        $this->switchTo(AccountRole::Admin);
        $this->admitAccountFixture();
        $context = $this->formContext($this->get('/account'));
        $this->admitAccountFixture();
        $this->service->update(['active' => false]);
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertStatus(422);
        $this->admitAccountFixture();
        $this->service->update(['active' => true]);
        $this->admin->setSpecialty($this->adminActor, $this->service->specialty, false);
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertStatus(422);
        $this->admitAccountFixture();
        $this->admin->setSpecialty($this->adminActor, $this->service->specialty, true);
        $this->profile->workingHours()->delete();
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertStatus(422);
        $this->admitAccountFixture();
        $this->assertSame(ProfileStatus::Pending, $this->profile->refresh()->status);
    }

    /** @return void */
    public function test_nonadmin_cannot_enter_admin_http_or_domain_boundaries(): void
    {
        foreach (['admin.index', 'admin.applications', 'admin.bookings', 'admin.specialties'] as $route) {
            $this->get(route($route))->assertForbidden();
        }
        $this->get(route('admin.application', $this->profile->id))->assertForbidden();
        foreach (['admin.publish', 'admin.suspend'] as $route) {
            $this->post(route($route, $this->profile->id), ['_actor_context' => $this->context])->assertForbidden();
        }
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $this->context, 'enabled' => 0])->assertForbidden();
        $this->admitAccountFixture();
        foreach ([$this->client, $this->stylist] as $actor) {
            $this->assertRejected(fn () => $this->admin->publish($actor, $this->profile), 403);
            $this->assertRejected(fn () => $this->admin->suspend($actor, $this->profile), 403);
            $this->assertRejected(fn () => $this->admin->setSpecialty($actor, $this->service->specialty, false), 403);
        }
    }

    /** @return void */
    public function test_admin_has_oversight_without_payment_cancellation_or_private_inbox_access(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $message = InboxMessage::query()->sole();
        $this->switchTo(AccountRole::Admin);
        $context = $this->formContext($this->get('/account'));
        $this->get(route('admin.bookings'))->assertOk()->assertSee('Signature cut')->assertSee($this->client->name)->assertDontSee(route('checkout.store', $booking->id), false)->assertDontSee(route('bookings.cancel', $booking->id), false);
        $this->get(route('bookings.show', $booking->id))->assertNotFound();
        $this->get(route('checkout.show', $booking->id))->assertNotFound();
        $this->post(route('checkout.store', $booking->id), ['_actor_context' => $context, 'outcome' => 'succeeded'])->assertNotFound();
        $this->post(route('bookings.cancel', $booking->id), ['_actor_context' => $context])->assertNotFound();
        $adminPrivateInboxResponse = $this->post(route('inbox.read', $message->id), ['_actor_context' => $context]);
        $adminPrivateInboxResponse->assertNotFound();
        $inbox = $this->get('/inbox?user_id='.$this->stylist->id)->assertOk();
        $this->assertSame(0, $inbox->viewData('messages')->total());
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'stylist', 'user_id' => $this->stylist->id])->assertStatus(422);
    }

    /** @return void */
    public function test_admin_counts_and_filtered_pagination_agree_after_deadline_expiry(): void
    {
        $booking = $this->bookings->accept($this->stylist, $this->bookings->request($this->client, $this->input(), $this->now), $this->now);
        $this->switchTo(AccountRole::Admin);
        $this->travelTo($booking->deposit_deadline);
        $overview = $this->get(route('admin.index'))->assertOk();
        $this->assertSame(1, $overview->viewData('bookingCount'));
        $requested = $this->get(route('admin.bookings', ['status' => BookingStatus::AwaitingDeposit->value]))->assertOk();
        $this->assertSame(0, $requested->viewData('appointments')->total());
        $this->assertSame(0, $requested->viewData('counts')->get(BookingStatus::AwaitingDeposit->value));
        $expired = $this->get(route('admin.bookings', ['status' => BookingStatus::Expired->value]))->assertOk();
        $this->assertSame(1, $expired->viewData('appointments')->total());
        $this->assertSame(1, $expired->viewData('counts')->get(BookingStatus::Expired->value));
        $this->assertSame(1, $expired->viewData('counts')->sum());
        $this->admitAccountFixture();
        $this->assertSame(1, $this->bookings->countForActor($this->client, BookingStatus::Expired, $booking->deposit_deadline));
        $this->travelBack();
    }

    /** @return void */
    public function test_admin_specialty_toggle_keeps_history_and_rejects_stale_or_unexpected_input(): void
    {
        $booking = $this->bookings->request($this->client, $this->input(), $this->now);
        $snapshot = $booking->fresh()->getAttributes();
        $this->switchTo(AccountRole::Admin);
        $context = $this->formContext($this->get(route('admin.specialties'))->assertOk());
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => 'stale', 'enabled' => 0])->assertStatus(409);
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $context, 'enabled' => 'wrong'])->assertStatus(422);
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $context, 'enabled' => 0, 'name' => 'Injected'])->assertStatus(422);
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $context, 'enabled' => 0])->assertRedirect(route('admin.specialties').'#specialty-'.$this->service->specialty_id);
        $this->get(route('admin.specialties'))->assertOk()->assertSee('Cuts is now unavailable.')->assertSee('Make available')->assertDontSee('data-confirm=', false);
        $this->admitAccountFixture();
        $this->assertFalse($this->service->specialty->fresh()->enabled);
        $this->assertSame($snapshot, $booking->fresh()->getAttributes());
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $context, 'enabled' => 1])->assertRedirect();
        $this->admitAccountFixture();
        $this->assertTrue($this->service->specialty->fresh()->enabled);
    }

    /** @return void */
    public function test_pending_private_portfolio_is_visible_in_admin_review_and_not_discovery(): void
    {
        $this->profile->update(['status' => ProfileStatus::Pending]);
        $path = $this->runtime->path('review-image.png');
        file_put_contents($path, PortfolioImages::bytes());
        $sandbox = app(SandboxService::class)->admit(session()->driver(), $this->now);
        $image = DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->store($this->stylist, $sandbox, new PortfolioInput(image: new UploadedFile($path, 'review.png', 'image/png', null, true), caption: 'Fictional work <script>escaped</script>')));
        $this->get(route('portfolio.show', $image->id))->assertNotFound();
        $this->switchTo(AccountRole::Admin);
        $this->get(route('admin.application', $this->profile->id))->assertOk()->assertSee(route('portfolio.show', $image->id))->assertSee('&lt;script&gt;escaped&lt;/script&gt;', false)->assertDontSee('<script>escaped</script>', false);
        $this->get(route('portfolio.show', $image->id))->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->get(route('stylists.show', $this->profile->id))->assertNotFound();
    }

    /** @return void */
    public function test_lists_are_paginated_and_invalid_filters_return_actionable_422(): void
    {
        $this->switchTo(AccountRole::Admin);
        $this->admitAccountFixture();
        config(['demo.pagination' => 1]);
        Specialty::query()->create(['name' => 'Colour', 'slug' => 'colour', 'enabled' => true]);
        $first = $this->get(route('admin.specialties'))->assertOk();
        $this->assertSame(2, $first->viewData('specialties')->total());
        $this->assertCount(1, $first->viewData('specialties'));
        $this->get(route('admin.specialties', ['page' => 2]))->assertOk()->assertSee('Page 2 of 2');
        $context = $this->formContext($first);
        $this->post(route('admin.specialties.update', $this->service->specialty_id), ['_actor_context' => $context, 'enabled' => 0])->assertRedirect(route('admin.specialties', ['page' => 2]).'#specialty-'.$this->service->specialty_id);
        $this->get(route('admin.specialties', ['page' => 2]))->assertOk()->assertSee('Cuts is now unavailable.');
        foreach (['admin.applications', 'admin.bookings', 'admin.specialties'] as $route) {
            $this->get(route($route, ['page' => 0]))->assertStatus(422)->assertSee('Return to overview');
            $this->get(route($route, ['status' => 'unknown']))->assertStatus(422);
        }
    }

    /** @return void */
    public function test_profile_conflict_stays_on_review_and_stale_actor_keeps_session_response(): void
    {
        $this->switchTo(AccountRole::Admin);
        $context = $this->formContext($this->get('/account'));
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => $context])->assertStatus(409)->assertViewIs('admin.application')->assertSee('Only submitted or suspended profiles')->assertDontSee('Your session changed');
        $this->post(route('admin.suspend', $this->profile->id), ['_actor_context' => $context])->assertRedirect();
        $this->post(route('admin.suspend', $this->profile->id), ['_actor_context' => $context])->assertStatus(409)->assertViewIs('admin.application')->assertSee('Only published profiles')->assertSee('Restore publication')->assertDontSee('Your session changed');
        $this->post(route('admin.publish', $this->profile->id), ['_actor_context' => 'stale'])->assertStatus(409)->assertSee('Your session changed');
    }

    /** @return void */
    public function test_publish_and_suspend_reject_malformed_pagination_without_breaking_review_recovery(): void
    {
        config(['demo.pagination' => 1]);
        $this->profile->services()->create(['specialty_id' => $this->service->specialty_id, 'name' => 'Second fictional cut', 'price_cents' => 3000, 'duration_minutes' => 60, 'active' => true]);
        foreach ([1, 2] as $position) {
            $this->profile->portfolioImages()->create(['seed_asset' => 'work-0'.$position.'.svg', 'caption' => 'Fictional review '.$position, 'position' => $position]);
        }
        $this->switchTo(AccountRole::Admin);
        $context = $this->formContext($this->get('/account'));
        foreach (['admin.publish' => ProfileStatus::Pending, 'admin.suspend' => ProfileStatus::Published] as $route => $status) {
            $this->admitAccountFixture();
            $this->profile->update(['status' => $status]);
            $snapshot = $this->profile->fresh()->getAttributes();
            foreach (['services_page', 'images_page'] as $parameter) {
                foreach ([0, 'rejected-page-value', ['rejected-page-key' => 'rejected-page-value']] as $value) {
                    $response = $this->post(route($route, $this->profile->id).'?'.http_build_query([$parameter => $value]), ['_actor_context' => $context])->assertStatus(422)->assertViewIs('admin.application')->assertSee('This form contains unsupported fields.')->assertSee($status === ProfileStatus::Pending ? 'Publish studio' : 'Suspend studio')->assertSee('Studio reviews')->assertDontSee('rejected-page-value')->assertDontSee('rejected-page-key');
                    $this->assertSame(1, $response->viewData('services')->currentPage());
                    $this->assertSame(1, $response->viewData('images')->currentPage());
                    $this->assertSame(route('admin.application', $this->profile->id).'?services_page=2', $response->viewData('services')->nextPageUrl());
                    $this->assertSame(route('admin.application', $this->profile->id).'?images_page=2', $response->viewData('images')->nextPageUrl());
                    $this->admitAccountFixture();
                    $this->assertSame($snapshot, $this->profile->fresh()->getAttributes());
                }
            }
        }
    }

    /** @return void */
    public function test_review_get_validates_pagination_and_preserves_only_validated_independent_pages(): void
    {
        config(['demo.pagination' => 1]);
        $this->profile->services()->create(['specialty_id' => $this->service->specialty_id, 'name' => 'Second fictional cut', 'price_cents' => 3000, 'duration_minutes' => 60, 'active' => true]);
        foreach ([1, 2] as $position) {
            $this->profile->portfolioImages()->create(['seed_asset' => 'work-0'.$position.'.svg', 'caption' => 'Fictional review '.$position, 'position' => $position]);
        }
        $this->switchTo(AccountRole::Admin);
        foreach (['services_page', 'images_page'] as $parameter) {
            foreach ([0, ['rejected-page-key' => 'rejected-page-value']] as $value) {
                $this->get(route('admin.application', $this->profile->id).'?'.http_build_query([$parameter => $value]))->assertStatus(422)->assertViewIs('admin.invalid')->assertSee('Return to overview')->assertDontSee('rejected-page-value');
            }
        }
        $review = $this->get(route('admin.application', ['profile' => $this->profile->id, 'services_page' => 2, 'images_page' => 2, 'unsupported' => 'rejected-page-value']))->assertOk()->assertDontSee('rejected-page-value');
        $this->assertSame(2, $review->viewData('services')->currentPage());
        $this->assertSame(2, $review->viewData('images')->currentPage());
        foreach (['services', 'images'] as $list) {
            parse_str(parse_url($review->viewData($list)->previousPageUrl(), PHP_URL_QUERY), $query);
            $this->assertEquals(['services_page' => $list === 'services' ? '1' : '2', 'images_page' => $list === 'images' ? '1' : '2'], $query);
        }
    }

    /** @param AccountRole $role
     * @return void */
    protected function switchTo(AccountRole $role): void
    {
        $this->post('/demo/role', ['_actor_context' => $this->formContext($this->get('/account')), 'role' => $role->value])->assertRedirect($role === AccountRole::Admin ? route('admin.index') : route('workspace.index'));
        $this->withCookie('strand_city_session', session()->getId());
    }

    /** @param Closure $operation
     * @param int $status
     * @return void */
    protected function assertRejected(Closure $operation, int $status): void
    {
        try {
            $operation();
            $this->fail('Unauthorized or unavailable operation succeeded.');
        } catch (HttpException $exception) {
            $this->assertSame($status, $exception->getStatusCode());
        } catch (AuthorizationException) {
            $this->assertSame(403, $status);
        }
    }
}
