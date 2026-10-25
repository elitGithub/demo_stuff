<?php

namespace Tests\Feature;

use App\Data\DiscoveryFilter;
use App\Enums\AccountRole;
use App\Enums\DiscoverySort;
use App\Enums\ProfileStatus;
use App\Models\PortfolioImage;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use App\Services\DiscoveryService;
use DOMDocument;
use DOMXPath;
use Illuminate\Testing\TestResponse;
use Tests\Support\BuildsAccountRuntime;
use Tests\TestCase;

class DiscoveryTest extends TestCase
{
    use BuildsAccountRuntime;

    protected Specialty $cuts;

    protected Specialty $colour;

    protected int $profileIndex = 0;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildAccountRuntime();
        $this->enterAccountDemo();
        $this->admitAccountFixture();
        $this->cuts = Specialty::query()->create(['name' => 'Cuts', 'slug' => 'cuts', 'enabled' => true]);
        $this->colour = Specialty::query()->create(['name' => 'Colour', 'slug' => 'colour', 'enabled' => true]);
    }

    /**
     * @param  string  $name
     * @param  string  $city
     * @param  int  $price
     * @return StylistProfile
     */
    protected function createProfile(string $name = 'A Fictional Stylist', string $city = 'paris', int $price = 2000): StylistProfile
    {
        $this->profileIndex++;
        $owner = User::query()->create(['name' => $name, 'email' => 'discovery-'.$this->profileIndex.'@stylist.example', 'password' => User::query()->firstOrFail()->password, 'role' => AccountRole::Stylist]);
        $profile = $owner->profile()->create(['display_name' => $name, 'studio_name' => 'Atelier Sample', 'biography' => 'A fictional place for your next look.', 'address' => '1 Fictional Lane', 'city_code' => $city, 'timezone' => config('demo.locations.'.$city.'.timezone'), 'status' => ProfileStatus::Published, 'deposit_percent' => 30, 'portrait_asset' => 'stylist-01.svg']);
        $profile->specialties()->attach([$this->cuts->id, $this->colour->id]);
        $profile->services()->create(['specialty_id' => $this->cuts->id, 'name' => 'Signature cut', 'price_cents' => $price, 'duration_minutes' => 45, 'active' => true]);

        return $profile;
    }

    /**
     * @param  ?string  $search
     * @param  ?string  $country
     * @param  ?string  $city
     * @param  ?int  $specialty
     * @param  ?int  $minimum
     * @param  ?int  $maximum
     * @param  DiscoverySort  $sort
     * @param  int  $page
     * @return DiscoveryFilter
     */
    protected function filter(?string $search = null, ?string $country = null, ?string $city = null, ?int $specialty = null, ?int $minimum = null, ?int $maximum = null, DiscoverySort $sort = DiscoverySort::Name, int $page = 1): DiscoveryFilter
    {
        return new DiscoveryFilter(search: $search, countryCode: $country, cityCode: $city, specialtyId: $specialty, minimumCents: $minimum, maximumCents: $maximum, sort: $sort, page: $page);
    }

    /**
     * @param  TestResponse  $response
     * @return DOMXPath
     */
    protected function discoveryDocument(TestResponse $response): DOMXPath
    {
        $document = new DOMDocument;
        $document->loadHTML('<?xml encoding="utf-8" ?>'.$response->getContent(), LIBXML_NOERROR | LIBXML_NOWARNING);

        return new DOMXPath($document);
    }

    /**
     * @return void
     */
    public function test_invalid_filter_response_retains_choices_errors_and_corrects_in_place(): void
    {
        $this->createProfile(price: 9000);
        $query = ['city' => 'paris', 'country' => 'FR', 'specialty' => (string) $this->cuts->id, 'minimum' => '80', 'maximum' => '20', 'search' => 'Atelier', 'sort' => DiscoverySort::PriceDescending->value];
        $response = $this->get('/discover?'.http_build_query($query))->assertStatus(422)->assertViewIs('discovery.invalid')->assertSee('Please check your filters.')->assertDontSee('0 artists')->assertSee('The maximum price must be at least the minimum price.');
        $this->assertNull($response->viewData('profiles'));
        foreach ($query as $field => $value) {
            $this->assertSame($value, $response->viewData('values')[$field]);
        }
        $document = $this->discoveryDocument($response);
        $this->assertSame('paris', $document->evaluate('string(//select[@name="city"]/option[@selected]/@value)'));
        $this->assertSame('FR', $document->evaluate('string(//select[@name="country"]/option[@selected]/@value)'));
        $this->assertSame((string) $this->cuts->id, $document->evaluate('string(//select[@name="specialty"]/option[@selected]/@value)'));
        $this->assertSame(DiscoverySort::PriceDescending->value, $document->evaluate('string(//select[@name="sort"]/option[@selected]/@value)'));
        $this->assertSame('80', $document->evaluate('string(//input[@name="minimum"]/@value)'));
        $this->assertSame('20', $document->evaluate('string(//input[@name="maximum"]/@value)'));
        $this->assertSame('Atelier', $document->evaluate('string(//input[@name="search"]/@value)'));
        $this->assertSame('true', $document->evaluate('string(//input[@name="maximum"]/@aria-invalid)'));
        $this->assertSame('maximum-error', $document->evaluate('string(//input[@name="maximum"]/@aria-describedby)'));
        $this->assertSame('The maximum price must be at least the minimum price.', $document->evaluate('string(//*[@id="maximum-error"])'));
        $this->assertSame('true', $document->evaluate('string(//details/@data-keep-open)'));
        $query['maximum'] = '90.00';
        $corrected = $this->get('/discover?'.http_build_query($query))->assertOk()->assertSee('1 artist')->assertSee('€90.00')->assertDontSee('Please check your filters.');
        $this->assertSame(8000, $corrected->viewData('filter')->minimumCents);
        $this->assertSame(9000, $corrected->viewData('filter')->maximumCents);
    }

    /**
     * @return void
     */
    public function test_invalid_filter_values_are_bounded_scalars_and_escaped(): void
    {
        $arrays = array_fill_keys(['city', 'country', 'specialty', 'minimum', 'maximum', 'search', 'sort'], ['<script>array()</script>']);
        $response = $this->get('/discover?'.http_build_query($arrays))->assertStatus(422)->assertSee('Please check your filters.')->assertDontSee('<script>array()</script>', false)->assertDontSee('Array');
        $this->assertSame(array_fill_keys(array_keys($response->viewData('values')), ''), $response->viewData('values'));
        $document = $this->discoveryDocument($response);
        $this->assertSame('', $document->evaluate('string(//input[@name="minimum"]/@value)'));
        $this->assertSame('true', $document->evaluate('string(//input[@name="minimum"]/@aria-invalid)'));
        $this->assertSame('minimum-error', $document->evaluate('string(//input[@name="minimum"]/@aria-describedby)'));
        $this->assertSame('Enter one minimum price.', $document->evaluate('string(//*[@id="minimum-error"])'));
        $bounded = $this->get('/discover?'.http_build_query(['search' => str_repeat('<', 1000), 'minimum' => str_repeat('9', 1000)]))->assertStatus(422);
        $this->assertSame(str_repeat('<', 80), $bounded->viewData('values')['search']);
        $this->assertSame(str_repeat('9', 8), $bounded->viewData('values')['minimum']);
        $this->get('/discover?'.http_build_query(['search' => '<script>text()</script>', 'minimum' => '1e2']))->assertStatus(422)->assertSee('&lt;script&gt;text()&lt;/script&gt;', false)->assertDontSee('<script>text()</script>', false)->assertSee('Enter a minimum price from €0 to €1,000 with up to two decimal places.');
    }

    /**
     * @return void
     */
    public function test_sort_progress_stays_outside_phone_filters_without_disabling_serialization(): void
    {
        $response = $this->get('/discover?sort=price_descending')->assertOk();
        $document = $this->discoveryDocument($response);
        $this->assertSame(1, $document->query('//*[@id="sort-progress" and not(ancestor::details)]')->length);
        $this->assertSame(1, $document->query('//*[@id="sort-progress" and @data-loading-for="discovery-filter" and @role="status" and @hidden]')->length);
        $this->assertSame('discovery-filter', $document->evaluate('string(//select[@name="sort"]/@form)'));
        $this->assertSame('discovery-filter', $document->evaluate('string(//select[@name="sort"]/@data-loading-control-for)'));
        $this->assertSame('sort-progress', $document->evaluate('string(//select[@name="sort"]/@aria-describedby)'));
        $this->assertSame('price_descending', $document->evaluate('string(//select[@name="sort"]/option[@selected]/@value)'));
        $this->assertSame(0, $document->query('//select[@name="sort"]/@disabled')->length);
        $this->assertSame('false', $document->evaluate('string(//details/@data-keep-open)'));
    }

    /**
     * @return void
     */
    public function test_card_price_uses_the_matching_service(): void
    {
        $profile = $this->createProfile();
        $profile->services()->create(['specialty_id' => $this->colour->id, 'name' => 'Colour', 'price_cents' => 9000, 'duration_minutes' => 90, 'active' => true]);
        $matchingProfile = app(DiscoveryService::class)->search($this->filter(specialty: $this->colour->id, minimum: 8000))->sole();
        $this->assertSame(9000, $matchingProfile->starting_price_cents);
        $this->get('/discover?specialty='.$this->colour->id.'&minimum=80')->assertOk()->assertSee('€90.00')->assertDontSee('€20.00');
    }

    /**
     * @return void
     */
    public function test_pagination_and_counts_share_filters(): void
    {
        for ($index = 0; $index < 13; $index++) {
            $this->createProfile('Matching Artist');
        }
        $this->createProfile('Not Matching', 'berlin');
        $discovery = app(DiscoveryService::class);
        $firstPage = $discovery->search($this->filter(city: 'paris'));
        $secondPage = $discovery->search($this->filter(city: 'paris', page: 2));
        $this->assertSame(13, $firstPage->total());
        $this->assertCount(12, $firstPage->items());
        $this->assertCount(1, $secondPage->items());
        $this->assertEmpty(array_intersect($firstPage->pluck('id')->all(), $secondPage->pluck('id')->all()));
        $this->get('/discover?city=paris&page=2')->assertOk()->assertSee('13 artists')->assertSee('Showing 13–13')->assertSee('city=paris', false)->assertDontSee('Not Matching');
    }

    /**
     * @return void
     */
    public function test_validation_rejects_bad_ranges_locations_sorts_and_shapes(): void
    {
        foreach ([['minimum' => '80', 'maximum' => '20'], ['city' => 'unknown'], ['country' => 'XX'], ['sort' => 'arbitrary'], ['search' => ['wrong']], ['search' => str_repeat('x', 81)], ['minimum' => '-1'], ['maximum' => '1000.01'], ['minimum' => '1e2'], ['minimum' => '20.001'], ['maximum' => '.50'], ['maximum' => 'NaN'], ['minimum' => ['wrong']], ['page' => 0], ['services_page' => 10001], ['portfolio_page' => 0], ['specialty' => 98765]] as $query) {
            $this->get('/discover?'.http_build_query($query))->assertStatus(422)->assertSee('Please check your filters.');
        }
        $this->getJson('/discover?sort=bad')->assertStatus(422)->assertJsonValidationErrors('sort');
    }

    /**
     * @return void
     */
    public function test_eur_price_boundary_converts_exactly_without_rounding(): void
    {
        $this->createProfile(price: 2001);
        $response = $this->get('/discover?minimum=20.01&maximum=20.01')->assertOk()->assertSee('€20.01');
        $this->assertSame(2001, $response->viewData('filter')->minimumCents);
        $this->assertSame(2001, $response->viewData('filter')->maximumCents);
        $this->assertSame(1, $response->viewData('profiles')->total());
        $this->get('/discover?minimum=20.02')->assertOk()->assertSee('0 artists');
        $this->get('/discover?minimum=0&maximum=1000.00')->assertOk()->assertSee('€20.01');
        $this->get('/discover?minimum=20.1&maximum=20.10')->assertOk()->assertSee('0 artists');
    }

    /**
     * @return void
     */
    public function test_unicode_names_and_wildcards_are_literal_bound_searches(): void
    {
        $unicode = $this->createProfile('Élodie 梓');
        $wildcard = $this->createProfile('100%_Style\\Studio');
        $this->createProfile('100AAStyleZStudio');
        $discovery = app(DiscoveryService::class);
        $this->assertSame($unicode->id, $discovery->search($this->filter(search: '梓'))->sole()->id);
        foreach (['%', '_', '\\', '100%_Style\\'] as $literal) {
            $this->assertSame($wildcard->id, $discovery->search($this->filter(search: $literal))->sole()->id);
        }
        $this->assertSame(0, $discovery->search($this->filter(search: "' OR 1=1 --"))->total());
        $this->get('/discover?'.http_build_query(['search' => 'Élodie 梓']))->assertOk()->assertSee('Élodie 梓')->assertDontSee('100AAStyleZStudio');
    }

    /**
     * @return void
     */
    public function test_escaping_empty_results_and_incompatible_location_filters(): void
    {
        $profile = $this->createProfile('<script>alert(1)</script>');
        $profile->update(['biography' => '<img src=x onerror=alert(1)>']);
        $this->get('/discover')->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
        $this->get('/stylists/'.$profile->id)->assertOk()->assertSee('&lt;img src=x onerror=alert(1)&gt;', false)->assertDontSee('<img src=x onerror=alert(1)>', false);
        $this->get('/discover?city=berlin&country=FR')->assertOk()->assertSee('0 artists')->assertSee('No stylists match these filters.');
        $this->get('/discover?search=nobody')->assertOk()->assertSee('A fresh search, a new possibility.')->assertSee('See all stylists');
    }

    /**
     * @return void
     */
    public function test_suspended_and_unpublished_profiles_return_404(): void
    {
        $profile = $this->createProfile();
        foreach ([ProfileStatus::Suspended, ProfileStatus::Draft, ProfileStatus::Pending] as $status) {
            $this->admitAccountFixture();
            $profile->update(['status' => $status]);
            $this->assertSame(0, app(DiscoveryService::class)->search($this->filter())->total());
            $this->get('/stylists/'.$profile->id)->assertNotFound();
        }
    }

    /**
     * @return void
     */
    public function test_disabled_specialties_and_inactive_services_are_ineligible(): void
    {
        $profile = $this->createProfile();
        $profile->services()->update(['active' => false]);
        $profile->services()->create(['specialty_id' => $this->colour->id, 'name' => 'Unavailable colour', 'price_cents' => 9000, 'duration_minutes' => 90, 'active' => true]);
        $this->colour->update(['enabled' => false]);
        $this->assertSame(0, app(DiscoveryService::class)->search($this->filter())->total());
        $this->get('/stylists/'.$profile->id)->assertOk()->assertDontSee('Signature cut')->assertDontSee('Unavailable colour')->assertSee('no available services');
        $this->get('/discover?specialty='.$this->colour->id)->assertStatus(422);
    }

    /**
     * @return void
     */
    public function test_price_sorting_uses_matching_minimum_and_stable_ids(): void
    {
        $cheaper = $this->createProfile('Zeta Artist', price: 2000);
        $dearer = $this->createProfile('Alpha Artist', price: 7000);
        $samePrice = $this->createProfile('Zeta Artist', price: 2000);
        $discovery = app(DiscoveryService::class);
        $this->assertSame([$cheaper->id, $samePrice->id, $dearer->id], $discovery->search($this->filter(sort: DiscoverySort::PriceAscending))->pluck('id')->all());
        $this->assertSame([$dearer->id, $cheaper->id, $samePrice->id], $discovery->search($this->filter(sort: DiscoverySort::PriceDescending))->pluck('id')->all());
        $this->assertSame([$dearer->id, $cheaper->id, $samePrice->id], $discovery->search($this->filter())->pluck('id')->all());
        $this->assertSame([$cheaper->id, $samePrice->id], $discovery->search($this->filter(minimum: 2000, maximum: 2000))->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_profile_services_and_portfolio_have_independent_bounded_pages(): void
    {
        $profile = $this->createProfile();
        for ($index = 1; $index <= 13; $index++) {
            PortfolioImage::query()->create(['profile_id' => $profile->id, 'seed_asset' => 'work-'.str_pad((string) $index, 2, '0', STR_PAD_LEFT).'.svg', 'caption' => 'Sample '.$index, 'position' => $index]);
            if ($index > 1) {
                Service::query()->create(['profile_id' => $profile->id, 'specialty_id' => $this->cuts->id, 'name' => 'Service '.$index, 'price_cents' => 2000 + $index, 'duration_minutes' => 45, 'active' => true]);
            }
        }
        $response = $this->get('/stylists/'.$profile->id.'?services_page=2&portfolio_page=1')->assertOk()->assertSee('13 available services')->assertSee('13 portfolio images')->assertSee('Service 13')->assertDontSee('Signature cut')->assertSee('Sample 12')->assertDontSee('Sample 13');
        $this->assertCount(1, $response->viewData('services')->items());
        $this->assertCount(12, $response->viewData('portfolio')->items());
        $this->get('/stylists/'.$profile->id.'?services_page=1&portfolio_page=2')->assertOk()->assertSee('Signature cut')->assertDontSee('Service 13')->assertSee('Sample 13')->assertDontSee('Sample 12');
    }

    /**
     * @return void
     */
    public function test_discovery_and_shared_navigation_point_to_configured_demo_stylist(): void
    {
        $demoProfile = StylistProfile::query()->whereHas('user', fn ($users) => $users->where('email', config('demo.seed_accounts.stylist')))->sole();
        $demoProfile->update(['status' => ProfileStatus::Published, 'studio_name' => 'The Journey Studio']);
        $demoProfile->services()->create(['specialty_id' => $this->cuts->id, 'name' => 'Journey cut', 'price_cents' => 2000, 'duration_minutes' => 45, 'active' => true]);
        $page = $this->get('/demo/ready')->assertOk()->assertSee('The Journey Studio')->assertSee('Meet '.$demoProfile->display_name)->assertSee('Try a role')->assertDontSee('seeded')->assertSee(route('stylists.show', $demoProfile->id), false);
        $this->post('/demo/role', ['_actor_context' => $this->formContext($page), 'role' => 'stylist'])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/workspace')->assertOk()->assertSee('You are exploring as Stylist.')->assertSee('Studio settings');
        $this->get('/account')->assertOk()->assertSee('Try a role')->assertDontSee('Your session.')->assertDontSee('Try another perspective.');
    }
}
