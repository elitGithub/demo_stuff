<?php

namespace App\Services;

use App\Data\DiscoveryCatalogue;
use App\Data\DiscoveryFilter;
use App\Data\StylistCatalogue;
use App\Enums\DiscoverySort;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Pagination\LengthAwarePaginator;

class DiscoveryService
{
    /**
     * @return DiscoveryCatalogue
     */
    public function catalogue(): DiscoveryCatalogue
    {
        return new DiscoveryCatalogue(
            specialties: Specialty::query()->where('enabled', true)->orderBy('name')->limit(count(config('demo.seed.specialties')))->get(),
            demoStylist: StylistProfile::query()->discoverable()->whereHas('user', fn (Builder $users): Builder => $users->where('email', config('demo.seed_accounts.stylist')))->first(),
        );
    }

    /**
     * @param  int  $profileId
     * @param  int  $servicesPage
     * @param  int  $portfolioPage
     * @return StylistCatalogue
     *
     * @throws ModelNotFoundException
     */
    public function stylistCatalogue(int $profileId, int $servicesPage, int $portfolioPage): StylistCatalogue
    {
        $profile = $this->profile($profileId);

        return new StylistCatalogue(
            profile: $profile,
            services: $profile->services()->eligible()->with('specialty')->orderBy('price_cents')->orderBy('id')->paginate(config('demo.pagination'), ['*'], 'services_page', $servicesPage)->withQueryString(),
            portfolio: $profile->portfolioImages()->orderBy('position')->orderBy('id')->paginate(config('demo.pagination'), ['*'], 'portfolio_page', $portfolioPage)->withQueryString(),
        );
    }

    /**
     * @param  DiscoveryFilter  $filter
     * @return LengthAwarePaginator<StylistProfile>
     */
    public function search(DiscoveryFilter $filter): LengthAwarePaginator
    {
        $matchingServices = Service::query()->matching($filter);
        $profiles = StylistProfile::query()->discoverable()
            ->whereHas('services', fn (Builder $services): Builder => $services->matching($filter))
            ->addSelect(['starting_price_cents' => (clone $matchingServices)->selectRaw('MIN(price_cents)')->whereColumn('services.profile_id', 'stylist_profiles.id')])
            ->with(['specialties' => fn ($specialties) => $specialties->where('enabled', true)->orderBy('name')->limit(count(config('demo.seed.specialties')))])
            ->when($filter->cityCode !== null, fn (Builder $query): Builder => $query->where('city_code', $filter->cityCode));

        if ($filter->countryCode !== null) {
            $cities = collect(config('demo.locations'))->filter(fn (array $location): bool => $location['country_code'] === $filter->countryCode)->keys()->all();
            $profiles->whereIn('city_code', $cities);
        }
        if ($filter->search !== null) {
            $term = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $filter->search).'%';
            $profiles->where(fn (Builder $query): Builder => $query->whereRaw("display_name LIKE ? ESCAPE '\\'", [$term])->orWhereRaw("studio_name LIKE ? ESCAPE '\\'", [$term]));
        }

        match ($filter->sort) {
            DiscoverySort::Name => $profiles->orderBy('display_name'),
            DiscoverySort::PriceAscending => $profiles->orderBy('starting_price_cents'),
            DiscoverySort::PriceDescending => $profiles->orderByDesc('starting_price_cents'),
        };

        return $profiles->orderBy('stylist_profiles.id')->paginate(config('demo.pagination'), ['*'], 'page', $filter->page)->withQueryString();
    }

    /**
     * @param  int  $profileId
     * @return StylistProfile
     *
     * @throws ModelNotFoundException
     */
    public function profile(int $profileId): StylistProfile
    {
        return StylistProfile::query()->discoverable()->with(['specialties' => fn ($specialties) => $specialties->where('enabled', true)->orderBy('name')->limit(count(config('demo.seed.specialties')))])->findOrFail($profileId);
    }
}
