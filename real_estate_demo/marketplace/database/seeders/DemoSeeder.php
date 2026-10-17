<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use App\Services\RequestPhotoStorage;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $storage = app(RequestPhotoStorage::class);
        $written = [];

        try {
            DB::transaction(function () use ($storage, &$written): void {
                foreach (['users', 'categories', 'provider_profiles', 'category_provider_profile', 'service_requests',
                    'request_photos', 'quotes', 'messages', 'job_events', 'reviews', 'payments', 'notifications'] as $table) {
                    if (DB::table($table)->exists()) {
                        throw new RuntimeException('Demo setup requires an empty marketplace. Existing data was not changed.');
                    }
                }

                $categories = [];
                foreach ([
                    ['Cleaning', 'sparkles', 'A fresh start, from a weekly reset to a deep clean.'],
                    ['Plumbing', 'pipe', 'Little drips to bigger fixes, handled with care.'],
                    ['Electrical', 'bolt', 'Brighter rooms and safely working essentials.'],
                    ['Painting', 'brush', 'A new color. A whole new feeling.'],
                    ['Gardening', 'leaf', 'A little care for your own patch of green.'],
                    ['Handyman', 'wrench', 'The small projects that make a big difference.'],
                ] as [$name, $icon, $description]) {
                    $categories[$name] = Category::create(['name' => $name, 'slug' => Str::slug($name),
                        'icon' => $icon, 'description' => $description, 'is_active' => true]);
                }
                $alex = $this->user('Alex Morgan', 'customer', 'customer');
                $taylor = $this->user('Taylor Brooks', 'admin', 'admin');
                $casey = $this->user('Casey Ellis', 'customer');
                $jamie = $this->user('Jamie Rivera', 'customer');
                $providers = [];
                foreach ([
                    ['Jordan Reed', 'Juniper Home Services', ['Plumbing', 'Handyman'], ['Austin', 'Round Rock'], 'approved', 'provider', 'Thoughtful repairs, tidy finishes and a friendly face. From a dripping tap to that shelf you have been meaning to hang, we help you feel at home.'],
                    ['Maya Chen', 'Clearwater Plumbing', ['Plumbing'], ['Austin', 'Cedar Park'], 'approved', null, 'Careful diagnostics and clear explanations. We make the small plumbing problems feel small again.'],
                    ['Ella Patel', 'Sunday Cleaning Co.', ['Cleaning'], ['Austin', 'Round Rock'], 'approved', null, 'The feeling of a freshly reset home, without losing your Sunday. Regular cleaning, deep cleans and move-out care.'],
                    ['Noah Williams', 'Good Ground Gardens', ['Gardening'], ['Austin', 'Cedar Park'], 'approved', null, 'Healthy plants, neat edges and outdoor spaces that invite you to stay a little longer.'],
                    ['Sam Okafor', 'Brightside Electric', ['Electrical'], ['Austin', 'Round Rock'], 'approved', null, 'Practical electrical help with careful checks, clear communication and a tidy workspace.'],
                    ['Luca Bennett', 'Soft Hue Painting', ['Painting'], ['Austin', 'Cedar Park'], 'approved', null, 'Fresh color and considered preparation. We care about the details you notice every day.'],
                    ['Owen Park', 'Oak & Level Repairs', ['Handyman'], ['Austin'], 'pending', null, 'Small home improvements, carefully measured and finished. Ready to join the Haven community.'],
                    ['Riley Brooks', 'Fresh Nest Home Care', ['Cleaning'], ['Round Rock'], 'suspended', null, 'Home cleaning and seasonal resets for busy households.'],
                ] as [$name, $business, $services, $areas, $status, $key, $bio]) {
                    $user = $this->user($name, 'provider', $key);
                    $profile = ProviderProfile::create(['user_id' => $user->id, 'business_name' => $business,
                        'slug' => Str::slug($business), 'bio' => $bio, 'service_areas' => $areas, 'status' => $status]);
                    $profile->categories()->attach(array_map(fn (string $name) => $categories[$name]->id, $services));
                    $providers[$name] = $user;
                }
                $jordan = $providers['Jordan Reed'];
                $tap = $this->job($alex, $categories['Plumbing'], 'Leaking kitchen tap',
                    'There is a slow drip at the base of the kitchen tap. Looking for someone to replace the seals, check the fittings and leave things tidy.', 'open', 25000, 3);
                $first = $this->quote($tap, $jordan, 18550, 'Replace the worn seals, check the connections and test for leaks. Includes standard parts and cleanup.');
                $second = $this->quote($tap, $providers['Maya Chen'], 21000, 'Inspect the mixer, replace seals and test water pressure. Parts and a careful cleanup included.');
                $first->messages()->create(['sender_id' => $alex->id, 'body' => 'Hi Jordan! Would a morning visit work? The tap is easy to reach.', 'created_at' => now()->subHours(4)]);
                $first->messages()->create(['sender_id' => $jordan->id, 'body' => 'Absolutely. I can be there at 9. I’ll bring the usual seals and check everything before I start.', 'created_at' => now()->subHours(3)]);
                $second->messages()->create(['sender_id' => $providers['Maya Chen']->id, 'body' => 'Happy to help. My quote includes the replacement parts and a pressure check.', 'created_at' => now()->subHours(2)]);
                $stored = $storage->store(new UploadedFile(database_path('demo/request-kitchen.png'), 'kitchen-tap-demo.png', 'image/png', null, true));
                $written[] = $stored['path'];
                $tap->photos()->create($stored);

                $shelves = $this->job($alex, $categories['Handyman'], 'Mount hallway shelves',
                    'Two oak shelves for the hallway. Please find the studs, level the shelves and tidy the drilling dust.', 'in_progress', 18000, 0);
                $this->agreement($shelves, $jordan, 14500, 'Mount two supplied oak shelves with suitable wall fixings.');
                $doors = $this->job($alex, $categories['Handyman'], 'Rehang interior doors',
                    'Two interior doors catch against the frame. Adjust hinges and make sure both close smoothly.', 'awaiting_confirmation', 22000, -1);
                $this->agreement($doors, $jordan, 19500, 'Adjust and rehang two interior doors, check gaps and closing action.');
                $bathroom = $this->job($alex, $categories['Plumbing'], 'Replace bathroom mixer',
                    'Replace an old bathroom mixer with a supplied new fixture and check all connections.', 'completed', 30000, -6);
                $this->agreement($bathroom, $jordan, 26500, 'Fit the supplied mixer, replace connectors and check for leaks.', 'Clear communication, careful work and everything left spotless. The bathroom feels new again.');
                $garden = $this->job($alex, $categories['Gardening'], 'Garden tidy-up',
                    'A seasonal reset for our small back garden: trim shrubs, weed the beds and tidy the edges.', 'booked', 24000, 5);
                $this->agreement($garden, $providers['Noah Williams'], 22500, 'Half-day garden tidy including green-waste removal.');
                $paint = $this->job($alex, $categories['Painting'], 'Bedroom repaint',
                    'We were planning to refresh a small bedroom in a warm off-white, but are postponing the project.', 'cancelled', 45000, 7);
                $this->quote($paint, $providers['Luca Bennett'], 42000, 'Prepare walls and apply two coats of supplied low-odor paint.', 'declined');
                $paint->events()->create(['actor_id' => $alex->id, 'type' => 'cancelled', 'description' => 'The customer postponed this project.', 'created_at' => now()->subDay()]);
                $this->job($casey, $categories['Handyman'], 'Repair loose cabinet hinges',
                    'Three kitchen cabinet hinges need adjustment. One screw hole may need a small repair.', 'open', 12000, 4);
                $clean = $this->job($jamie, $categories['Cleaning'], 'End-of-tenancy clean',
                    'A final deep clean for a small two-bedroom home before handing over the keys.', 'completed', 32000, -10);
                $this->agreement($clean, $providers['Ella Patel'], 29500, 'Full two-bedroom move-out clean including oven and inside cupboards.', 'An exceptionally thorough clean and a friendly, punctual team. Everything was ready for the handover.');

                $alex->notify(new MarketplaceNotification('Two ways to a drip-free kitchen', 'Compare proposals from Juniper Home Services and Clearwater Plumbing.', 'requests.show', ['serviceRequest' => $tap->id]));
                $alex->notify(new MarketplaceNotification('Your doors are ready', 'Jordan has finished the work. Take a look and confirm completion.', 'requests.show', ['serviceRequest' => $doors->id]));
                $jordan->notify(new MarketplaceNotification('A neighbor needs a hand', 'A cabinet repair in Austin matches your services.', 'requests.show', ['serviceRequest' => ServiceRequest::where('title', 'Repair loose cabinet hinges')->sole()->id]));
                $jordan->notify(new MarketplaceNotification('A kind word from Alex', 'You received a 5-star review for the bathroom mixer replacement.', 'requests.show', ['serviceRequest' => $bathroom->id]));
                $jordan->notifications()->oldest()->first()->markAsRead();
                $taylor->notify(new MarketplaceNotification('A new professional is waiting', 'Oak & Level Repairs is ready for profile review.', 'admin.providers.index'));
            });
        } catch (Throwable $exception) {
            foreach ($written as $path) {
                $storage->delete($path);
            }
            throw $exception;
        }
    }

    private function user(string $name, string $role, ?string $key = null): User
    {
        $user = new User;
        $user->forceFill([
            'name' => $name, 'email' => Str::slug($name, '.').'@example.test',
            'password' => Str::random(64), 'role' => $role, 'demo_key' => $key,
            'phone' => '+1 512 555 0100', 'email_verified_at' => now(),
        ])->save();

        return $user;
    }

    private function job(User $customer, Category $category, string $title, string $description, string $status, int $budget, int $days): ServiceRequest
    {
        $job = $customer->requests()->create([
            'category_id' => $category->id, 'title' => $title, 'description' => $description,
            'service_area' => 'Austin', 'street_address' => '1842 Fictional Juniper Lane (demo address)',
            'preferred_date' => now()->addDays($days)->toDateString(), 'budget_cents' => $budget,
            'status' => $status, 'created_at' => now()->subDays(max(2, -$days + 4)),
        ]);
        $job->events()->create(['actor_id' => $customer->id, 'type' => 'posted', 'description' => 'Request shared with local professionals.', 'created_at' => $job->created_at]);

        return $job;
    }

    private function quote(ServiceRequest $job, User $provider, int $amount, string $scope, string $status = 'pending'): Quote
    {
        return $job->quotes()->create([
            'provider_id' => $provider->id, 'amount_cents' => $amount, 'available_date' => $job->preferred_date,
            'scope' => $scope, 'status' => $status, 'version' => 1, 'created_at' => $job->created_at->addHours(2),
        ]);
    }

    private function agreement(ServiceRequest $job, User $provider, int $amount, string $scope, ?string $review = null): void
    {
        $quote = $this->quote($job, $provider, $amount, $scope, 'accepted');
        $job->update(['accepted_quote_id' => $quote->id]);
        $events = [
            'booked' => [$job->customer_id, 'A professional was hired.'],
            'in_progress' => [$provider->id, 'Your professional started the work.'],
            'awaiting_confirmation' => [$provider->id, 'Work is ready for the customer to confirm.'],
            'completed' => [$job->customer_id, 'The customer confirmed the job is complete.'],
        ];
        $hour = 3;
        foreach ($events as $state => [$actor, $description]) {
            $job->events()->create(['actor_id' => $actor, 'type' => $state, 'description' => $description,
                'created_at' => $job->created_at->addHours($hour++)]);
            if ($state === $job->status->value) {
                break;
            }
        }
        $quote->messages()->create(['sender_id' => $provider->id, 'body' => 'Thanks for choosing us. I’ll keep you updated here as we go.', 'created_at' => $job->created_at->addHours(4)]);
        if ($review !== null) {
            $job->payment()->create(['customer_id' => $job->customer_id, 'receipt_number' => (string) Str::uuid(),
                'amount_cents' => $amount, 'currency' => 'USD', 'status' => 'simulated_paid', 'paid_at' => $job->preferred_date]);
            $job->review()->create(['customer_id' => $job->customer_id, 'provider_id' => $provider->id,
                'rating' => 5, 'body' => $review, 'created_at' => $job->preferred_date->addDay()]);
        }
    }
}
