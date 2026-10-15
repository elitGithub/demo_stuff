<?php

namespace Database\Seeders;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Service;
use App\Models\Stylist;
use App\Models\User;
use App\Services\BillingService;
use App\Services\ReminderService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (! config('studio.demo')) {
            throw new RuntimeException('Demo seeding requires STUDIO_DEMO=true.');
        }
        if (User::exists() || Client::exists()) {
            throw new RuntimeException('This database is already populated. Seeding will not overwrite it.');
        }
        $password = config('studio.demo_password') ?: Str::random(24);
        DB::transaction(function () use ($password) {
            $user = User::create(['role' => 'owner', 'name' => 'Jordan Ellis', 'email' => config('studio.demo_email'), 'password' => Hash::make($password)]);
            $catalogue = [
                ['Signature cut & finish', 'Hair', 6500, 45, 'A thoughtful consultation, precision cut and effortless finish.'],
                ['Barber cut', 'Barbering', 3500, 30, 'Clean lines, considered texture and a style that feels like you.'],
                ['Blowout & styling', 'Styling', 4500, 45, 'A wash, beautiful blowout and finishing touches for any occasion.'],
                ['Lived-in colour', 'Colour', 14500, 105, 'Dimensional colour with a soft grow-out, tailored to your tones.'],
                ['Beard sculpt & hot towel', 'Barbering', 2500, 30, 'Shape, definition and a little time to unwind.'],
                ['Gloss & tone', 'Colour', 7500, 60, 'Refresh your shade with luminous shine and balanced tones.'],
                ['Scalp reset', 'Care', 4000, 30, 'A restorative treatment and massage for a happier scalp.'],
                ['Occasion styling', 'Styling', 9500, 75, 'Modern updos and polished waves, made for your moment.'],
            ];
            foreach ($catalogue as [$name, $category, $price, $duration, $description]) {
                Service::create(compact('name', 'category', 'price', 'duration', 'description'));
            }
            $team = [
                ['Alex Morgan', 'Creative director', 'Precision cuts, effortless texture and a very good conversation.', '#555453', [1, 2, 3, 5, 7]],
                ['Mia Bennett', 'Colour specialist', 'Lived-in colour, subtle dimension and healthy, luminous hair.', '#8b8077', [1, 3, 4, 6, 7, 8]],
                ['Leo Santos', 'Senior barber', 'Sharp fades, classic cuts and the details that make a difference.', '#777d83', [2, 5, 7]],
                ['Zoe Park', 'Stylist & finish expert', 'Natural movement, beautiful finishes and occasion-ready styling.', '#9b9296', [1, 3, 6, 7, 8]],
            ];
            foreach ($team as [$name, $title, $bio, $color, $ids]) {
                $stylist = Stylist::create(compact('name', 'title', 'bio', 'color') + ['commission_rate' => 15, 'working_days' => [0, 1, 2, 3, 4, 5, 6], 'start_time' => '09:00', 'end_time' => '19:00']);
                $stylist->services()->attach($ids);
            }
            $names = ['Olivia James', 'Noah Williams', 'Emma Laurent', 'Liam Brooks', 'Sophia Chen', 'Ethan Cooper', 'Isabella Rossi', 'Oliver Reed', 'Amelia Clarke', 'Lucas Martin', 'Charlotte Evans', 'Theo Wilson', 'Ava Mitchell', 'Henry Scott', 'Grace Turner', 'Daniel Hayes', 'Ella Moore', 'Oscar Bennett'];
            $styles = ['Soft layers & face framing', 'Textured crop', 'Collarbone bob', 'Classic taper', 'Long layers, soft waves', 'Low fade'];
            foreach ($names as $i => $name) {
                $client = Client::create(['name' => $name, 'email' => Str::slug($name, '.').'@example.test', 'phone' => '+1555010'.str_pad((string) ($i + 100), 4, '0', STR_PAD_LEFT), 'style_name' => $styles[$i % 6], 'style_notes' => $i % 2 ? 'Keep natural texture on top. Soft neckline; no hard part. Prefers a low-maintenance finish.' : 'Keep the length around the face. Soft movement, warm tones and an easy air-dry finish.', 'preferred_stylist_id' => $i % 4 + 1, 'preferred_services' => [$i % 2 ? 2 : 1], 'channels' => $i % 3 ? ['email'] : ['email', 'whatsapp'], 'maintenance_weeks' => $i % 2 ? 4 : 6, 'created_at' => now()->subDays(100 - $i * 4)]);
                $client->notes()->create(['user_id' => $user->id, 'body' => $i % 2 ? 'Likes a quiet early appointment. Discuss maintenance before finishing.' : 'Loved the last finish. Offer the same shape next visit.', 'created_at' => now()->subDays($i + 1)]);
                if ($i < 6) {
                    $client->followUps()->create(['title' => $i % 2 ? 'Check in and book the next cut' : 'Colour refresh consultation', 'due_date' => now()->addDays($i - 2)->toDateString()]);
                }
            }
            $today = CarbonImmutable::now(config('studio.timezone'))->startOfDay();
            for ($i = 0; $i < 24; $i++) {
                $stylist = Stylist::find($i % 4 + 1);
                $service = $stylist->services()->orderBy('id')->first();
                $start = $today->subDays(2 + intdiv($i, 4))->setTime(10 + $i % 3, 0);
                $appointment = $this->visit($i % 18 + 1, $stylist, $service, $start, 'completed');
                $invoice = app(BillingService::class)->issue($appointment);
                $invoice->update(['issued_at' => $start]);
                if ($i < 20) {
                    app(BillingService::class)->pay($invoice, $i % 2 ? 'card' : 'cash');
                    $invoice->update(['paid_at' => $start]);
                    $invoice->payment()->update(['recorded_at' => $start]);
                }
            }
            for ($i = 0; $i < 12; $i++) {
                $stylist = Stylist::find($i % 4 + 1);
                $service = $stylist->services()->orderBy('id')->first();
                $start = $today->addDays(intdiv($i, 8))->setTime(9 + ($i % 8), $i % 2 ? 30 : 0);
                $appointment = $this->visit($i + 1, $stylist, $service, $start, $start->addMinutes($service->duration)->isPast() ? 'completed' : ($i % 3 ? 'confirmed' : 'booked'));
                if ($appointment->status === 'completed') {
                    app(BillingService::class)->pay(app(BillingService::class)->issue($appointment), 'card');
                } else {
                    app(ReminderService::class)->schedule($appointment);
                }
            }
            $this->call([CommerceSeeder::class, PipelineSeeder::class, OutreachSeeder::class]);
        });
        if (! app()->environment('testing')) {
            Storage::disk('local')->put('demo-credentials.json', json_encode(['email' => config('studio.demo_email'), 'password' => $password], JSON_PRETTY_PRINT));
            chmod(Storage::disk('local')->path('demo-credentials.json'), 0600);
        }
    }

    private function visit(int $clientId, Stylist $stylist, Service $service, CarbonImmutable $start, string $status): Appointment
    {
        $appointment = Appointment::create(['client_id' => $clientId, 'stylist_id' => $stylist->id, 'starts_at' => $start->utc(), 'ends_at' => $start->addMinutes($service->duration)->utc(), 'status' => $status, 'total' => $service->price]);
        $appointment->items()->create(['service_id' => $service->id, 'name' => $service->name, 'price' => $service->price, 'duration' => $service->duration]);

        return $appointment;
    }
}
