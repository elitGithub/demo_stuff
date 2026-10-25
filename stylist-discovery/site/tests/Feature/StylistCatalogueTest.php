<?php

namespace Tests\Feature;

use App\Data\ServiceInput;
use App\Data\StylistInput;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Services\StylistService;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsAccountRuntime;
use Tests\TestCase;

class StylistCatalogueTest extends TestCase
{
    use BuildsAccountRuntime;

    protected string $actorContext;

    protected StylistProfile $profile;

    protected Specialty $cuts;

    protected Specialty $colour;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildAccountRuntime();
        $entry = $this->enterAccountDemo();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($entry), 'role' => AccountRole::Stylist->value])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $this->actorContext = $this->formContext($this->get('/stylist/setup')->assertOk());
        $this->admitAccountFixture();
        $this->profile = StylistProfile::query()->sole();
        $this->cuts = Specialty::query()->create(['name' => 'Cuts', 'slug' => 'cuts', 'enabled' => true]);
        $this->colour = Specialty::query()->create(['name' => 'Colour', 'slug' => 'colour', 'enabled' => true]);
        $this->profile->specialties()->attach($this->cuts);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function profilePayload(array $overrides = []): array
    {
        return array_replace(['_actor_context' => $this->actorContext, 'display_name' => 'Mira Fictional', 'studio_name' => 'Atelier Sample', 'biography' => 'Thoughtful cuts and a warm welcome.', 'address' => '1 Fictional Studio Lane', 'city_code' => 'paris', 'deposit_percent' => '25', 'specialty_ids' => [(string) $this->cuts->id]], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function servicePayload(array $overrides = []): array
    {
        return array_replace(['_actor_context' => $this->actorContext, 'name' => 'Signature cut', 'specialty_id' => (string) $this->cuts->id, 'price' => '19.99', 'duration_minutes' => '45', 'active' => '1'], $overrides);
    }

    /**
     * @param  BookingStatus  $status
     * @return Booking
     */
    protected function snapshotBooking(BookingStatus $status = BookingStatus::Confirmed): Booking
    {
        $service = $this->profile->services()->sole();
        $startsAt = CarbonImmutable::now()->addDays(3)->startOfHour();

        return Booking::query()->create(['client_id' => User::query()->where('role', AccountRole::Client)->sole()->id, 'profile_id' => $this->profile->id, 'service_id' => $service->id, 'request_key' => '12345678-1234-1234-1234-123456789012', 'input_fingerprint' => str_repeat('a', 64), 'service_name' => $service->name, 'price_cents' => $service->price_cents, 'duration_minutes' => $service->duration_minutes, 'deposit_percent' => 25, 'deposit_cents' => 500, 'remaining_cents' => 1499, 'currency' => 'EUR', 'timezone' => 'Europe/Paris', 'starts_at' => $startsAt, 'ends_at' => $startsAt->addMinutes(45), 'status' => $status, 'accepted_at' => CarbonImmutable::now(), 'deposit_deadline' => CarbonImmutable::now()->addMinutes(30), 'notification_budget' => 6]);
    }

    /**
     * @return void
     */
    public function test_guided_studio_routes_and_contextual_save_actions_are_real(): void
    {
        $this->get('/discover')->assertOk()->assertSee('Workspace')->assertSee(route('workspace.index'), false);
        $this->get('/workspace')->assertOk()->assertSee('Studio settings')->assertSee(route('stylist.onboarding'), false);
        $this->get('/stylist/setup')->assertOk()->assertSee('Your studio checklist')->assertSee('0 of 3 essentials ready')->assertSee(route('stylist.profile.edit'), false)->assertSee(route('stylist.services.index'), false)->assertDontSee('Coming soon')->assertDontSee('href="#availability"', false);
        $this->patch('/stylist/profile', $this->profilePayload())->assertRedirect('/stylist/profile#save-result');
        $this->get('/stylist/profile')->assertOk()->assertSee('Your profile and deposit settings are saved.')->assertSee('Continue to your service menu')->assertSee(route('stylist.services.index'), false)->assertSee('id="save-result" tabindex="-1" data-save-result', false);
        $this->get('/stylist/services/create')->assertOk()->assertSee('Make room for')->assertSee('name="price"', false);
        $created = $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->assertStringEndsWith('#save-result', $created->headers->get('Location'));
        $this->admitAccountFixture();
        $service = $this->profile->services()->sole();
        $this->get('/stylist/services/'.$service->id.'/edit')->assertOk()->assertSee('Your service is saved.')->assertSee('View your updated menu')->assertSee('Continue your studio setup')->assertSee('id="save-result" tabindex="-1" data-save-result', false);
        $this->get('/stylist/setup')->assertOk()->assertSee('2 of 3 essentials ready');
    }

    /**
     * @return void
     */
    public function test_profile_drafts_and_deposit_boundaries_preserve_status(): void
    {
        $this->assertSame(25, config('demo.registration.deposit_percent'));
        $this->assertSame(25, $this->profile->deposit_percent);
        $this->patch('/stylist/profile', $this->profilePayload(['display_name' => '', 'studio_name' => '', 'biography' => '', 'address' => '', 'specialty_ids' => []]))->assertRedirect('/stylist/profile#save-result');
        foreach ([10, 100] as $percentage) {
            $this->patch('/stylist/profile', $this->profilePayload(['deposit_percent' => (string) $percentage]))->assertRedirect('/stylist/profile#save-result');
            $this->admitAccountFixture();
            $this->assertSame($percentage, $this->profile->fresh()->deposit_percent);
            $this->assertSame(ProfileStatus::Draft, $this->profile->fresh()->status);
        }
        foreach ([9, 101] as $percentage) {
            $this->patch('/stylist/profile', $this->profilePayload(['deposit_percent' => (string) $percentage]))->assertStatus(422)->assertSee('Please check your details')->assertSee('value="'.$percentage.'"', false);
        }
        $this->patch('/stylist/profile', $this->profilePayload(['status' => 'published']))->assertStatus(422)->assertSee('unsupported fields');
        $this->patch('/stylist/profile', $this->profilePayload(['user_id' => '1']))->assertStatus(422);
        $this->patch('/stylist/profile', $this->profilePayload(['biography' => '<script>unsafe()</script>']))->assertStatus(422)->assertSee('&lt;script&gt;unsafe()&lt;/script&gt;', false)->assertDontSee('<script>unsafe()</script>', false);
        $this->admitAccountFixture();
        $this->assertSame(ProfileStatus::Draft, $this->profile->fresh()->status);
    }

    /**
     * @return void
     */
    public function test_service_prices_convert_exactly_and_malformed_values_are_rejected(): void
    {
        $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->admitAccountFixture();
        $service = $this->profile->services()->sole();
        $this->assertSame(1999, $service->price_cents);
        foreach (['1e2', '19.999', '.50', '0.99', '1000.01', '-5', 'NaN', '01.99', ['wrong']] as $price) {
            $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['price' => $price]))->assertStatus(422)->assertSee('Please check your details');
        }
        foreach (['1.00' => 100, '1000.00' => 100000, '20.1' => 2010] as $price => $cents) {
            $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['price' => $price]))->assertRedirect('/stylist/services/'.$service->id.'/edit#save-result');
            $this->admitAccountFixture();
            $this->assertSame($cents, $service->fresh()->price_cents);
        }
        foreach ([14, 241] as $minutes) {
            $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['duration_minutes' => (string) $minutes]))->assertStatus(422);
        }
    }

    /**
     * @return void
     */
    public function test_service_specialties_must_be_enabled_and_selected_and_active_ones_stay_selected(): void
    {
        $this->post('/stylist/services', $this->servicePayload(['specialty_id' => (string) $this->colour->id]))->assertStatus(422)->assertSee('Choose an enabled specialty from your profile.');
        $this->colour->update(['enabled' => false]);
        $this->patch('/stylist/profile', $this->profilePayload(['specialty_ids' => [$this->colour->id]]))->assertStatus(422);
        $this->post('/stylist/services', $this->servicePayload(['specialty_id' => (string) $this->colour->id]))->assertStatus(422);
        $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->patch('/stylist/profile', $this->profilePayload(['specialty_ids' => []]))->assertStatus(422)->assertSee('deactivate those services first');
        $this->admitAccountFixture();
        $service = $this->profile->services()->sole();
        $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['active' => '0']))->assertRedirect();
        $this->patch('/stylist/profile', $this->profilePayload(['specialty_ids' => []]))->assertRedirect();
        $this->admitAccountFixture();
        $this->assertFalse($service->fresh()->active);
        $this->assertSame(1, Service::query()->count());
    }

    /**
     * @return void
     */
    public function test_owner_can_deactivate_sole_disabled_specialty_service_and_recover_profile_through_http(): void
    {
        $this->patch('/stylist/profile', $this->profilePayload())->assertRedirect();
        $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->admitAccountFixture();
        $service = $this->profile->services()->sole();
        $booking = $this->snapshotBooking();
        $snapshot = $booking->fresh()->getAttributes();
        $this->profile->update(['status' => ProfileStatus::Published]);
        $this->cuts->update(['enabled' => false]);

        $editor = $this->get('/stylist/services/'.$service->id.'/edit')->assertOk()->assertSee('Cuts · unavailable')->assertSee('Keep your service history intact.')->assertSee('save the service as inactive')->assertSee('name="active"', false)->assertSee(route('stylist.profile.edit'), false)->assertDontSee('First, choose your specialties.');
        $this->assertSame([$this->cuts->id], $editor->viewData('specialties')->modelKeys());
        $this->assertTrue($editor->viewData('retainedSpecialty'));
        $this->get('/stylists/'.$this->profile->id)->assertOk()->assertDontSee('Signature cut')->assertSee('no available services');
        $this->patch('/stylist/profile', $this->profilePayload(['specialty_ids' => [$this->colour->id]]))->assertStatus(422)->assertSee('deactivate those services first');
        $this->post('/stylist/services', $this->servicePayload(['active' => '0']))->assertStatus(422);
        $this->patch('/stylist/services/'.$service->id, $this->servicePayload())->assertStatus(422)->assertSee('Choose an enabled specialty from your profile.');

        $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['active' => '0']))->assertRedirect('/stylist/services/'.$service->id.'/edit#save-result');
        $this->patch('/stylist/profile', $this->profilePayload(['biography' => 'My profile can be maintained again.', 'deposit_percent' => '50', 'specialty_ids' => [$this->colour->id]]))->assertRedirect();
        $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['name' => 'Retained signature cut', 'price' => '25.00', 'duration_minutes' => '60', 'active' => '0']))->assertRedirect();
        $this->get('/stylist/services/'.$service->id.'/edit')->assertOk()->assertSee('Cuts · unavailable')->assertSee('Colour');
        $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['active' => '1']))->assertStatus(422);
        $this->post('/stylist/services', $this->servicePayload())->assertStatus(422);

        $this->admitAccountFixture();
        $retainedService = $service->fresh();
        $this->assertSame(1, Service::query()->count());
        $this->assertSame($this->cuts->id, $retainedService->specialty_id);
        $this->assertFalse($retainedService->active);
        $this->assertSame(2500, $retainedService->price_cents);
        $this->assertSame(60, $retainedService->duration_minutes);
        $this->assertFalse(Service::query()->eligible()->whereKey($service->id)->exists());
        $this->assertSame([$this->colour->id], $this->profile->fresh()->specialties->modelKeys());
        $this->assertSame('My profile can be maintained again.', $this->profile->fresh()->biography);
        $this->assertSame(50, $this->profile->fresh()->deposit_percent);
        $this->assertSame($snapshot, $booking->fresh()->getAttributes());
    }

    /**
     * @return void
     */
    public function test_domain_boundary_retains_inactive_history_but_rejects_disabled_create_reactivate_and_relabel(): void
    {
        $stylists = app(StylistService::class);
        $actor = $this->profile->user;
        $service = $stylists->saveService($actor, null, new ServiceInput(name: 'Signature cut', specialtyId: $this->cuts->id, priceCents: 1999, durationMinutes: 45, active: true));
        $booking = $this->snapshotBooking();
        $snapshot = $booking->fresh()->getAttributes();
        $this->cuts->update(['enabled' => false]);
        $stylists->saveService($actor, $service, new ServiceInput(name: 'Retained cut', specialtyId: $this->cuts->id, priceCents: 2500, durationMinutes: 60, active: false));
        $stylists->saveProfile($actor, new StylistInput(displayName: 'Mira Fictional', studioName: 'Atelier Sample', biography: 'Recovered profile.', address: '1 Fictional Studio Lane', cityCode: 'paris', depositPercent: 40, specialtyIds: collect([$this->colour->id])));
        $maintainedService = $stylists->saveService($actor, $service->fresh(), new ServiceInput(name: 'Retained cut', specialtyId: $this->cuts->id, priceCents: 3000, durationMinutes: 75, active: false));
        $unrelatedDisabledSpecialty = Specialty::query()->create(['name' => 'Braids', 'slug' => 'braids', 'enabled' => false]);

        foreach ([null, $maintainedService] as $existingService) {
            foreach ([false, true] as $active) {
                if ($existingService !== null && ! $active) {
                    continue;
                }
                try {
                    $stylists->saveService($actor, $existingService, new ServiceInput(name: 'Forbidden disabled offering', specialtyId: $this->cuts->id, priceCents: 1999, durationMinutes: 45, active: $active));
                } catch (ValidationException $exception) {
                    $this->assertArrayHasKey('specialty_id', $exception->errors());

                    continue;
                }
                $this->fail('The domain accepted a disabled new or reactivated offering.');
            }
        }
        try {
            $stylists->saveService($actor, $maintainedService, new ServiceInput(name: 'Relabeled history', specialtyId: $unrelatedDisabledSpecialty->id, priceCents: 1999, durationMinutes: 45, active: false));
            $this->fail('The domain accepted an unrelated disabled specialty.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('specialty_id', $exception->errors());
        }
        $this->assertSame(1, Service::query()->count());
        $this->assertSame($service->id, $maintainedService->id);
        $this->assertSame($this->cuts->id, $maintainedService->fresh()->specialty_id);
        $this->assertFalse($maintainedService->fresh()->active);
        $this->assertSame(3000, $maintainedService->fresh()->price_cents);
        $this->assertSame([$this->colour->id], $this->profile->fresh()->specialties->modelKeys());
        $this->assertSame($snapshot, $booking->fresh()->getAttributes());
    }

    /**
     * @return void
     */
    public function test_another_stylists_service_is_not_readable_or_mutable(): void
    {
        $owner = User::query()->create(['name' => 'Other Stylist', 'email' => 'other@stylist.example', 'password' => User::query()->firstOrFail()->password, 'role' => AccountRole::Stylist]);
        $profile = $owner->profile()->create(['city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Draft]);
        $otherService = $profile->services()->create(['specialty_id' => $this->cuts->id, 'name' => 'Other service', 'price_cents' => 5000, 'duration_minutes' => 60, 'active' => true]);
        $this->get('/stylist/services/'.$otherService->id.'/edit')->assertNotFound();
        $this->patch('/stylist/services/'.$otherService->id, $this->servicePayload())->assertNotFound();
        $this->patch('/stylist/services/'.$otherService->id, $this->servicePayload(['price' => 'bad']))->assertNotFound();
        $this->post('/stylist/services', $this->servicePayload(['profile_id' => $profile->id]))->assertStatus(422);
        $this->admitAccountFixture();
        $this->assertSame(5000, $otherService->fresh()->price_cents);
    }

    /**
     * @return void
     */
    public function test_incomplete_submission_reports_each_missing_requirement_and_complete_submission_is_pending(): void
    {
        $this->post('/stylist/submit', ['_actor_context' => $this->actorContext])->assertStatus(422)->assertSee('Add your studio name.')->assertSee('Tell clients about your approach.')->assertSee('Add your studio address.')->assertSee('Add at least one active service')->assertSee('Add your weekly availability');
        $this->patch('/stylist/profile', $this->profilePayload())->assertRedirect();
        $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->admitAccountFixture();
        $this->profile->workingHours()->create(['weekday' => 1, 'opens_at' => '09:00', 'closes_at' => '18:00']);
        $this->post('/stylist/submit', ['_actor_context' => $this->actorContext])->assertRedirect('/stylist/setup');
        $this->admitAccountFixture();
        $this->assertSame(ProfileStatus::Pending, $this->profile->fresh()->status);
        $updatedAt = $this->profile->fresh()->updated_at;
        $this->post('/stylist/submit', ['_actor_context' => $this->actorContext])->assertRedirect('/stylist/setup');
        $this->admitAccountFixture();
        $this->assertTrue($updatedAt->equalTo($this->profile->fresh()->updated_at));
        $this->get('/stylist/setup')->assertOk()->assertSee('SUBMITTED FOR REVIEW')->assertSee('Review as demo admin')->assertDontSee('Submit for review');
    }

    /**
     * @return void
     */
    public function test_published_and_suspended_edits_retain_status_and_suspension_cannot_be_removed(): void
    {
        foreach ([ProfileStatus::Published, ProfileStatus::Suspended] as $status) {
            $this->admitAccountFixture();
            $this->profile->update(['status' => $status]);
            $this->patch('/stylist/profile', $this->profilePayload())->assertRedirect();
            $this->admitAccountFixture();
            $this->assertSame($status, $this->profile->fresh()->status);
            if ($status === ProfileStatus::Published) {
                $this->get('/stylist/setup')->assertOk()->assertSee('A menu worth coming back to.')->assertDontSee('Complete all three essentials, then send your profile for review.');
                $this->get('/stylist/profile')->assertOk()->assertSee('Your profile is live.')->assertDontSee('Your checklist shows what is still needed for review.');
            }
        }
        $this->post('/stylist/submit', ['_actor_context' => $this->actorContext])->assertStatus(422)->assertSee('Only the review team can restore publication.');
        $this->get('/stylist/setup')->assertOk()->assertSee('PUBLICATION PAUSED')->assertDontSee('Submit for review');
    }

    /**
     * @return void
     */
    public function test_catalogue_edits_and_deactivation_preserve_booking_snapshots_and_schedule_protection(): void
    {
        $this->post('/stylist/services', $this->servicePayload())->assertRedirect();
        $this->admitAccountFixture();
        $booking = $this->snapshotBooking();
        $service = $this->profile->services()->sole();
        $this->patch('/stylist/services/'.$service->id, $this->servicePayload(['name' => 'Updated cut', 'price' => '89.75', 'duration_minutes' => '90', 'active' => '0']))->assertRedirect();
        $this->patch('/stylist/profile', $this->profilePayload(['city_code' => 'berlin', 'deposit_percent' => '100']))->assertStatus(422)->assertSee('Booking #'.$booking->id);
        $this->patch('/stylist/profile', $this->profilePayload(['deposit_percent' => '100']))->assertRedirect();
        $this->admitAccountFixture();
        $this->assertSame(1999, $booking->fresh()->price_cents);
        $this->assertSame(45, $booking->fresh()->duration_minutes);
        $this->assertSame(25, $booking->fresh()->deposit_percent);
        $this->assertSame('Signature cut', $booking->fresh()->service_name);
        $this->assertSame(8975, $service->fresh()->price_cents);
        $this->assertFalse($service->fresh()->active);
        $booking->update(['status' => BookingStatus::AwaitingDeposit]);
        $this->patch('/stylist/profile', $this->profilePayload(['city_code' => 'lisbon']))->assertStatus(422);
        $this->admitAccountFixture();
        $booking->update(['status' => BookingStatus::Cancelled]);
        $this->patch('/stylist/profile', $this->profilePayload(['city_code' => 'lisbon']))->assertRedirect();
        $this->admitAccountFixture();
        $this->assertSame('Europe/Lisbon', $this->profile->fresh()->timezone);
        $this->assertSame('Europe/Paris', $booking->fresh()->timezone);
    }

    /**
     * @return void
     */
    public function test_service_capacity_allows_120th_and_rejects_121st_without_partial_rows(): void
    {
        for ($index = 1; $index < 120; $index++) {
            $this->profile->services()->create(['specialty_id' => $this->cuts->id, 'name' => 'Service '.$index, 'price_cents' => 2000, 'duration_minutes' => 45, 'active' => true]);
        }
        $this->post('/stylist/services', $this->servicePayload(['name' => 'The 120th service']))->assertRedirect();
        $this->post('/stylist/services', $this->servicePayload(['name' => 'The 121st service']))->assertStatus(429);
        $this->admitAccountFixture();
        $this->assertSame(120, Service::query()->count());
        $this->assertFalse(Service::query()->where('name', 'The 121st service')->exists());
    }

    /**
     * @return void
     */
    public function test_menu_paginates_and_client_role_cannot_enter_or_mutate_studio(): void
    {
        for ($index = 1; $index <= 13; $index++) {
            $this->profile->services()->create(['specialty_id' => $this->cuts->id, 'name' => 'Menu item '.$index, 'price_cents' => 2000, 'duration_minutes' => 45, 'active' => true]);
        }
        $page = $this->get('/stylist/services?page=2')->assertOk()->assertSee('13 services')->assertSee('Menu item 13')->assertDontSee('Menu item 12');
        $this->assertCount(1, $page->viewData('services')->items());
        $this->get('/stylist/services?page=0')->assertStatus(422);
        $this->get('/stylist/services?page=10001')->assertStatus(422);
        $this->post('/demo/role', ['_actor_context' => $this->actorContext, 'role' => AccountRole::Client->value])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $clientContext = $this->formContext($this->get('/account')->assertOk());
        $this->get('/stylist/setup')->assertForbidden();
        $this->get('/stylist/profile')->assertForbidden();
        $this->get('/stylist/services')->assertForbidden();
        $this->patch('/stylist/profile', $this->profilePayload(['_actor_context' => $clientContext]))->assertForbidden();
        $this->post('/stylist/services', $this->servicePayload(['_actor_context' => $clientContext]))->assertForbidden();
    }

    /**
     * @return void
     */
    public function test_invalid_shapes_render_bounded_values_and_json_422_without_flash(): void
    {
        $response = $this->patch('/stylist/profile', $this->profilePayload(['display_name' => ['bad'], 'biography' => str_repeat('z', 2000), 'specialty_ids' => [['bad']]]))->assertStatus(422)->assertDontSee('Array');
        $this->assertSame('', $response->viewData('values')['display_name']);
        $this->assertSame(1200, mb_strlen($response->viewData('values')['biography']));
        $this->assertSame([], $response->viewData('values')['specialty_ids']);
        $this->withCredentials()->postJson('/stylist/services', $this->servicePayload(['price' => '1e2']))->assertStatus(422)->assertJsonValidationErrors('price');
        $this->assertNull(session()->getOldInput('biography'));
    }
}
