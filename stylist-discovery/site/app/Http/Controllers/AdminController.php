<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\ProfileStatus;
use App\Http\Requests\AdminBookingRequest;
use App\Http\Requests\ReviewStylistRequest;
use App\Http\Requests\SpecialtyAvailabilityRequest;
use App\Models\Booking;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Services\AdminService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\MessageBag;
use Illuminate\Support\ViewErrorBag;
use Illuminate\View\View;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AdminController extends Controller
{
    /** @param Request $request
     * @param AdminService $admin
     * @return View */
    public function index(Request $request, AdminService $admin): View
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        $admin->expireBookings(CarbonImmutable::now('UTC'));

        return view('admin.index', ['pendingCount' => StylistProfile::query()->where('status', ProfileStatus::Pending)->count(), 'publishedCount' => StylistProfile::query()->where('status', ProfileStatus::Published)->count(), 'suspendedCount' => StylistProfile::query()->where('status', ProfileStatus::Suspended)->count(), 'bookingCount' => Booking::query()->count(), 'enabledCount' => Specialty::query()->where('enabled', true)->count(), 'nextProfile' => StylistProfile::query()->where('status', ProfileStatus::Pending)->orderBy('created_at')->orderBy('id')->first()]);
    }

    /** @param AdminBookingRequest $request
     * @param AdminService $admin
     * @return View */
    public function applications(AdminBookingRequest $request, AdminService $admin): View
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);

        return view('admin.applications', ['profiles' => $admin->applications((int) $request->validated('page', 1))->withQueryString()]);
    }

    /** @param Request $request
     * @param int $profile
     * @return View */
    public function application(Request $request, int $profile): View
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        $pages = $request->isMethod('GET') ? Validator::make($request->query(), ['services_page' => ['sometimes', 'integer', 'between:1,10000'], 'images_page' => ['sometimes', 'integer', 'between:1,10000']])->validate() : [];
        $record = StylistProfile::query()->with(['user', 'specialties', 'workingHours' => fn ($query) => $query->orderBy('weekday')])->findOrFail($profile);

        return view('admin.application', ['profile' => $record, 'services' => $record->services()->with('specialty')->orderBy('name')->orderBy('id')->paginate(config('demo.pagination'), ['*'], 'services_page', (int) ($pages['services_page'] ?? 1))->withPath(route('admin.application', $profile))->appends($pages), 'images' => $record->portfolioImages()->orderBy('position')->orderBy('id')->paginate(config('demo.pagination'), ['*'], 'images_page', (int) ($pages['images_page'] ?? 1))->withPath(route('admin.application', $profile))->appends($pages)]);
    }

    /** @param ReviewStylistRequest $request
     * @param AdminService $admin
     * @param int $profile
     * @return RedirectResponse|Response */
    public function publish(ReviewStylistRequest $request, AdminService $admin, int $profile): RedirectResponse|Response
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        try {
            $admin->publish($request->user(), StylistProfile::query()->findOrFail($profile));
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $form = $this->application($request, $profile);

            return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag(['profile' => $exception->getMessage()]))]), 409);
        }

        return redirect()->route('admin.application', $profile)->withFragment('review-result')->with('status', 'Profile published. Clients can discover this studio.');
    }

    /** @param ReviewStylistRequest $request
     * @param AdminService $admin
     * @param int $profile
     * @return RedirectResponse|Response */
    public function suspend(ReviewStylistRequest $request, AdminService $admin, int $profile): RedirectResponse|Response
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        try {
            $admin->suspend($request->user(), StylistProfile::query()->findOrFail($profile));
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $form = $this->application($request, $profile);

            return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag(['profile' => $exception->getMessage()]))]), 409);
        }

        return redirect()->route('admin.application', $profile)->withFragment('review-result')->with('status', 'Profile suspended. Existing appointments can continue.');
    }

    /** @param AdminBookingRequest $request
     * @param AdminService $admin
     * @return View */
    public function bookings(AdminBookingRequest $request, AdminService $admin): View
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        $now = CarbonImmutable::now('UTC');
        $status = $request->validated('status') !== null ? BookingStatus::from($request->validated('status')) : null;
        $appointments = $admin->bookings($status, (int) $request->validated('page', 1), $now)->withQueryString();
        $counts = collect(BookingStatus::cases())->mapWithKeys(fn (BookingStatus $state): array => [$state->value => Booking::query()->where('status', $state)->count()]);

        return view('admin.bookings', ['appointments' => $appointments, 'counts' => $counts, 'status' => $status, 'now' => $now]);
    }

    /** @param AdminBookingRequest $request
     * @return View */
    public function specialties(AdminBookingRequest $request): View
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);

        return view('admin.specialties', ['specialties' => Specialty::query()->orderBy('name')->paginate(config('demo.pagination'), ['*'], 'page', (int) $request->validated('page', 1))]);
    }

    /** @param SpecialtyAvailabilityRequest $request
     * @param AdminService $admin
     * @param int $specialty
     * @return RedirectResponse */
    public function setSpecialty(SpecialtyAvailabilityRequest $request, AdminService $admin, int $specialty): RedirectResponse
    {
        abort_unless($request->user()->hasRole(AccountRole::Admin), 403);
        $record = $admin->setSpecialty($request->user(), Specialty::query()->findOrFail($specialty), $request->boolean('enabled'));
        $page = intdiv(Specialty::query()->where('name', '<', $record->name)->count(), config('demo.pagination')) + 1;

        return redirect()->route('admin.specialties', $page > 1 ? ['page' => $page] : [])->withFragment('specialty-'.$specialty)->with('changed_specialty', $specialty)->with('status', $record->name.' is now '.($record->enabled ? 'available.' : 'unavailable.'));
    }
}
