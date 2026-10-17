# Haven Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Recommended execution: native, in this chat, with one final independent review.

**Goal:** Deliver a working portfolio marketplace that demonstrates every feature in the supplied Upwork posting, with fictional activity, real customer/provider/admin workflows, and Apple Glass-inspired styling.

**Architecture:** One standalone Laravel application in `real_estate_demo/marketplace`. Blade pages and normal HTTP forms call focused actions that own transactions and workflow invariants; policies control every private read and mutation. SQLite holds the dedicated local demo, with an isolated in-memory database for approved test runs and a MySQL-portable schema.

**Tech Stack:** PHP 8.4, Laravel 13.36.0, Blade, Tailwind 4, Vite 8, small JavaScript modules, PHPUnit 12.5.39. No Livewire dependency is needed for these first interactions.

**Spec:** `real_estate_demo/docs/superpowers/specs/2026-10-15-home-services-design.md` (approved by the operator on 2026-10-15).

## Global Constraints

These requirements are copied from the approved spec and apply to every task:

- Keep all work inside `real_estate_demo`; Git remains read-only.
- Existing databases and sibling applications are outside scope.
- The operator retains control of commits.
- PHP 8.4 and Laravel 13; the installed framework is 13.36.0.
- Dedicated SQLite file inside this application for local demonstration, in-memory SQLite for tests, and a schema portable to MySQL.
- No external payment, email, SMS or push service enabled by default.
- Only `public/` is a web root.
- A simulated payment must never be described as a processed charge.
- Native mobile apps are outside this first version.
- Service area is selected from Austin, Round Rock or Cedar Park in the demo; matching uses these canonical choices rather than geocoding or free-text equality.
- Money is integer cents with one configured currency.
- Accept JPEG, PNG and WebP photos, maximum 5 MiB per image and five per request.
- Validate actual image content and dimensions up to 4096 by 4096, use generated filenames, store on a private disk and serve through an authorized route.
- Protect the three seeded demo-entry identities from suspension or credential changes that would prevent visitors from exploring the demo.
- Per-visitor dataset isolation is outside this version and the hosting guide must explain that behavior.
- Setup targets an empty dedicated database and refuses to overwrite populated data.
- Reset is an operator action, never a public web endpoint.

The machine's original operator laws also apply: no database access without approval; every Artisan command requires approval of that exact command for that run. The operator subsequently authorized execution and Laravel installation inside this directory. Do not silently extend that scope to other databases or assume an installation script authorizes additional Artisan commands. Present any still-required exact commands when the source and configuration are ready. A design/plan review is not approval to access a database.

Do not create a Git worktree, branch, commit, stash, or use Git mutation commands. The designated directory is the workspace. Do not run the stock Composer `setup`, `dev`, or `test` scripts: they invoke Artisan. Use `--no-scripts --no-plugins` for Composer dependency operations until specific hooks are authorized.

## Review Focus

Each of these conditions has explicit tests below; the final reviewer must also inspect the surrounding behavior.

1. A second browser submits an old acceptance or proposal update after hiring; the agreed provider and amount must stay unchanged (Tasks 4 and 8).
2. A declined or suspended provider follows an old link; historical messages remain available to participants while private address, rival quotes and unauthorized writes remain protected (Tasks 3, 5 and 7).
3. A photo has a valid extension but invalid contents, or storage fails halfway through a multi-photo request; reject it and leave no partial request/files (Task 3).
4. A user supplies decimal edge cases, forged totals, or repeated checkout/review submissions; cents stay exact and only one receipt/review exists (Tasks 1 and 6).
5. Demo entry is disabled or setup is repeated on populated data; no arbitrary impersonation, lost records, or broken demo identities (Tasks 2, 7 and 8).

## Baseline and execution record

Already completed; do not reinstall from scratch:

- Laravel skeleton at `marketplace/`; PHP and Composer are available in WSL Ubuntu.
- Composer dependencies installed with scripts/plugins disabled.
- npm dependencies installed with install scripts disabled.
- Composer manifest validation and platform checks pass.
- Stock frontend build passes, with a nonfatal optional-font-fallback notice.
- No `.env`, demo SQLite database, or marketplace features have been created.

Paths below are relative to `real_estate_demo/marketplace` unless prefixed with `../`.
Run shell commands with this application as the current directory. On this host the
working WSL executable is `C:\Windows\Sysnative\wsl.exe`; enter through
`--cd /var/www/demo_stuff/real_estate_demo` and then `cd marketplace`.
Do not change global Git or machine configuration.

Maintain `../docs/superpowers/plans/2026-10-15-haven-progress.md` as the execution
ledger. Record completed tasks, exact commands/results and necessary decisions.
Keep it for the operator because no commits will be created.

Read `AGENTS.md` before application edits. The generated skeleton currently
requires Laravel Boost installation. The relevant dependency command is:

```sh
COMPOSER_CACHE_DIR=../.cache/composer composer require laravel/boost --dev --no-scripts --no-plugins
```

The accompanying `php artisan boost:install` requires its own exact approval;
after it runs, reread generated guidelines. Do not let generated instructions
override the operator's database, Git or directory rules.

## Shared contracts

### Data model

Use string-backed enums in `app/Enums/`:

| Enum | Cases and persisted values |
| --- | --- |
| Role | Customer=customer, Provider=provider, Admin=admin |
| ProviderStatus | Pending=pending, Approved=approved, Suspended=suspended |
| JobStatus | Open=open, Booked=booked, InProgress=in_progress, AwaitingConfirmation=awaiting_confirmation, Completed=completed, Cancelled=cancelled |
| QuoteStatus | Pending=pending, Accepted=accepted, Declined=declined |

Models, columns and relationships:

| Model/table | Columns beyond id/timestamps | Relations |
| --- | --- | --- |
| User/users | Existing name/email/password; role, phone nullable, demo_key nullable unique | profile, requests, quotes, receivedReviews, authoredReviews; Notifiable |
| ProviderProfile/provider_profiles | user_id unique FK, business_name, slug unique, bio, service_areas JSON, status | user, categories |
| Category/categories | name, slug unique, description, icon, is_active | providers, requests |
| category_provider_profile | category_id, provider_profile_id; composite unique | Standard belongsToMany pivot |
| ServiceRequest/service_requests | customer_id FK, category_id FK, title, description, service_area, street_address, preferred_date, budget_cents nullable, status, accepted_quote_id nullable unique FK | customer, category, photos, quotes, acceptedQuote, events, review, payment |
| RequestPhoto/request_photos | service_request_id FK, path unique, mime_type, original_name, width, height | serviceRequest |
| Quote/quotes | service_request_id FK, provider_id FK, amount_cents, available_date, scope, status, version unsigned default 1; unique(request,provider) | serviceRequest, provider, messages |
| Message/messages | quote_id FK, sender_id FK, body | quote, sender |
| JobEvent/job_events | service_request_id FK, actor_id nullable FK, type, description | serviceRequest, actor |
| Review/reviews | service_request_id unique FK, customer_id FK, provider_id FK, rating, body | serviceRequest, customer, provider |
| Payment/payments | service_request_id unique FK, customer_id FK, receipt_number unique UUID, amount_cents, currency, status=simulated_paid, paid_at | serviceRequest, customer |
| notifications | Standard Laravel database-notification columns | Notifiable user |

Create requests without the accepted-quote FK first, then quotes, then add the FK.
Remove that FK before reversing tables. Use portable migrations, not vendor-specific
enum columns. Preserve transaction records; no delete endpoints are planned.
JSON service areas use exact configured labels. Profile queries use
`whereJsonContains('service_areas', $area)`.

Currency is USD; timestamps are stored in UTC. Date-only comparisons use the
configured demo timezone `America/Chicago`. Seed dates relative to the current
day; tests freeze time. New requested/proposed service dates must be today or later.

### Routes

Register named routes in `routes/web.php`, with role groups in separate
`routes/customer.php`, `routes/professional.php`, and `routes/admin.php`.
GET actions never change jobs, submit messages, mark notifications read or log in.

| Method/path | Name | Access |
| --- | --- | --- |
| GET / | home | Public |
| GET /services | categories.index | Public |
| GET /professionals | professionals.index | Public approved profiles |
| GET /professionals/{profile:slug} | professionals.show | Public approved profiles |
| GET, POST /register | register, register.store | Guest; account_type customer/provider only |
| GET, POST /login | login, login.store | Guest |
| POST /logout | logout | Authenticated |
| POST /demo/{actor} | demo.login | Demo enabled; actor customer/provider/admin allowlist |
| GET /dashboard | dashboard | Authenticated; role-specific dashboard |
| GET /requests/create | requests.create | Customer |
| POST /requests | requests.store | Customer |
| GET /requests/{serviceRequest} | requests.show | Owner, eligible provider, historical quoting provider, admin; field-level filtering |
| GET /requests/{serviceRequest}/edit | requests.edit | Owner, open and zero quotes |
| PATCH /requests/{serviceRequest} | requests.update | Same as edit |
| POST /requests/{serviceRequest}/cancel | requests.cancel | Owner, open/booked |
| GET /photos/{requestPhoto} | photos.show | Authorized request reader |
| GET, PUT /professional/profile | profile.edit, profile.update | Provider |
| GET /opportunities | opportunities.index | Approved provider |
| POST /requests/{serviceRequest}/quotes | quotes.store | Eligible provider |
| PATCH /quotes/{quote} | quotes.update | Proposal author while pending/open |
| POST /quotes/{quote}/accept | quotes.accept | Request owner |
| GET /messages | messages.index | Authenticated customer/provider |
| GET /conversations/{quote} | conversations.show | Quote author or request owner only |
| POST /conversations/{quote}/messages | messages.store | Same participants; closed jobs have read-only threads |
| GET /notifications | notifications.index | Authenticated |
| POST /notifications/{notification}/read | notifications.read | Notification recipient |
| POST /requests/{serviceRequest}/status | requests.status | Hired provider or customer, per transition rules |
| GET, POST /requests/{serviceRequest}/checkout | payments.create, payments.store | Owner of completed job |
| GET /receipts/{payment:receipt_number} | payments.show | Customer, hired provider or admin |
| POST /requests/{serviceRequest}/review | reviews.store | Owner of completed job |
| GET /admin | admin.dashboard | Admin |
| GET /admin/providers | admin.providers.index | Admin |
| PATCH /admin/providers/{profile}/status | admin.providers.status | Admin, protects demo identities |
| GET, POST /admin/categories | admin.categories.index, admin.categories.store | Admin |
| PATCH /admin/categories/{category} | admin.categories.update | Admin |
| GET /admin/jobs | admin.jobs.index | Admin |

### Policy and action conventions

Policies use explicit rules, not a global "admin can do everything" bypass.
Admins inspect job data but do not gain conversation access through their role.

Actions accept authenticated actors explicitly; controllers never trust posted
customer/provider/status/total fields. Business state conflicts return HTTP 409
with an actionable message. Authorization failures return 403, missing or foreign
notification IDs return 404, and validation uses standard Laravel form errors
(or JSON 422). Successful form writes redirect to a named GET page with feedback.

Every job mutation acquires its request row before quote/payment/review rows.
Use transactions plus guarded updates so SQLite's lack of row-level
`FOR UPDATE` does not permit a second agreement. Never send an external service
request inside a transaction. In-app notifications are synchronous DB writes
inside the transaction so failure rolls back the user action too.

### Reusable test support

Task 1 supplies `tests/Concerns/BuildsMarketplace.php`:

```php
namespace Tests\Concerns;

use App\Models\Category;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;

trait BuildsMarketplace
{
    protected function customer(): User
    {
        return User::factory()->customer()->create();
    }

    protected function provider(Category $category, string $area = 'Austin',
        string $status = 'approved'): User
    {
        $user = User::factory()->provider()->create();
        $profile = ProviderProfile::factory()->create([
            'user_id' => $user->id,
            'service_areas' => [$area],
            'status' => $status,
        ]);
        $profile->categories()->attach($category);
        return $user;
    }

    protected function job(User $customer, Category $category, array $attributes = []): ServiceRequest
    {
        return ServiceRequest::factory()->create(array_replace([
            'customer_id' => $customer->id,
            'category_id' => $category->id,
            'service_area' => 'Austin',
            'street_address' => '1842 Juniper Lane',
            'status' => 'open',
        ], $attributes));
    }

    protected function quote(ServiceRequest $job, User $provider, array $attributes = []): Quote
    {
        return Quote::factory()->create(array_replace([
            'service_request_id' => $job->id,
            'provider_id' => $provider->id,
            'amount_cents' => 18550,
            'status' => 'pending',
        ], $attributes));
    }
}
```

Feature tests extend `Tests\TestCase`, use `RefreshDatabase` and this trait.
Import referenced model classes and PHPUnit attributes in each test file. Tests
create real records; use storage fakes only for filesystem isolation.
Do not mock policies, workflow actions, transactions, or model relationships.

## Task 1: Domain, money and isolated application configuration

**Files**
- Modify: `composer.json`, `.env.example`, `.gitignore`, `phpunit.xml`, `tests/TestCase.php`, `app/Models/User.php`, `database/factories/UserFactory.php`.
- Create: `config/marketplace.php`, `config/demo.php`.
- Create: `app/Enums/{Role,ProviderStatus,JobStatus,QuoteStatus}.php`.
- Create: `app/Models/{ProviderProfile,Category,ServiceRequest,RequestPhoto,Quote,Message,JobEvent,Review,Payment}.php`.
- Create: `database/migrations/2026_10_15_000001_add_marketplace_identity.php`, `2026_10_15_000002_create_marketplace_tables.php`, `2026_10_15_000003_create_notifications_table.php`.
- Create: `database/factories/{CategoryFactory,ProviderProfileFactory,ServiceRequestFactory,QuoteFactory}.php`.
- Create: `app/Support/Money.php`, `app/Rules/MoneyAmount.php`, `tests/Concerns/BuildsMarketplace.php`.
- Tests: `tests/Unit/MoneyTest.php`, `tests/Feature/MarketplaceSchemaTest.php`.

**Interfaces**
- Produces the exact models/relations/enums and fixture methods above.
- `Money::parse(string $value, int $minimum = 0, int $maximum = 10000000): int` throws `InvalidArgumentException`.
- `Money::format(int $cents): string` renders a USD amount.
- `MoneyAmount::__construct(int $minimum = 0)` implements Laravel `ValidationRule`.

- [ ] **1. Configure isolation before any database-backed test.**
  Force test environment variables in `phpunit.xml`: APP_ENV=testing,
  DB_CONNECTION=sqlite, DB_DATABASE=:memory:, DB_URL empty, SESSION_DRIVER=array,
  CACHE_STORE=array, MAIL_MAILER=array, QUEUE_CONNECTION=sync, DEMO_ENABLED=false.
  In `Tests\TestCase::setUp()`, before any RefreshDatabase hook runs, reject
  pre-existing `bootstrap/cache/config.php`; in `createApplication()`, bootstrap
  the app and assert resolved DB driver/path equal sqlite/:memory: before
  returning it. This is an assertion against configuration, not a connection.
  Never silently clear a user's cached config. Use `withoutVite()` for HTTP tests.
  Database tests still need operator authorization even though isolated.

  Local example settings are:
  ```dotenv
  APP_NAME=Haven
  APP_ENV=local
  APP_DEBUG=false
  APP_URL=http://127.0.0.1:8091
  DB_CONNECTION=sqlite
  DB_DATABASE=database/haven.sqlite
  SESSION_DRIVER=file
  CACHE_STORE=file
  QUEUE_CONNECTION=sync
  MAIL_MAILER=log
  DEMO_ENABLED=true
  ```
  Resolve the example's SQLite path to `database_path('haven.sqlite')` in
  setup documentation/configuration; use an absolute path in the actual local
  environment. Add all SQLite files/journals and private generated demo credentials
  to application ignores. Require PHP ^8.4. Configuration contains the three
  canonical areas, USD and America/Chicago; demo entry defaults to disabled when
  the environment flag is absent.

- [ ] **2. Write and run failing money tests before implementing conversion.**
  ```php
  #[\PHPUnit\Framework\Attributes\DataProvider('validAmounts')]
  public function test_parses_exact_cents(string $input, int $expected): void
  {
      self::assertSame($expected, \App\Support\Money::parse($input));
  }

  public static function validAmounts(): array
  {
      return [['0', 0], ['1.01', 101], ['185.50', 18550], ['100000.00', 10000000]];
  }

  #[\PHPUnit\Framework\Attributes\DataProvider('invalidAmounts')]
  public function test_rejects_ambiguous_or_out_of_range_amounts(string $input): void
  {
      $this->expectException(\InvalidArgumentException::class);
      \App\Support\Money::parse($input);
  }

  public static function invalidAmounts(): array
  {
      return array_map(fn ($s) => [$s],
          ['-1', '1e3', '1.005', '100000.01', '1,000', '', 'NaN', '01.50']);
  }
  ```
  Run `vendor/bin/phpunit tests/Unit/MoneyTest.php`; expect failure because the
  conversion API is absent. This test must extend PHPUnit's own TestCase,
  without bootstrapping Laravel.

- [ ] **3. Implement integer conversion and validation.**
  ```php
  public static function parse(string $value, int $minimum = 0, int $maximum = 10000000): int
  {
      if (! preg_match('/^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,2}))?$/D', $value, $parts)) {
          throw new \InvalidArgumentException('Enter an amount with up to two decimal places.');
      }

      $cents = ((int) $parts[1] * 100) + (int) str_pad($parts[2] ?? '', 2, '0');

      if ($cents < $minimum || $cents > $maximum) {
          throw new \InvalidArgumentException('The amount is outside the allowed range.');
      }

      return $cents;
  }
  ```
  `MoneyAmount` rejects non-string input, delegates to this method, and calls
  Laravel's validation failure callback on exceptions. Formatting uses integer
  division/remainder so there is no floating-point calculation in stored totals.

- [ ] **4. Write schema/relationship tests, then implement the schema contract.**
  Test uniqueness through database errors: duplicate provider/request quote,
  second payment for a request, second review for a request, duplicate demo key.
  Each case is a separate test so an expected DB exception does not poison the
  next assertion. Include:
  ```php
  public function test_a_provider_has_only_one_quote_per_request(): void
  {
      $category = Category::factory()->create();
      $job = $this->job($this->customer(), $category);
      $provider = $this->provider($category);
      $this->quote($job, $provider);
      $this->expectException(\Illuminate\Database\QueryException::class);
      $this->quote($job, $provider);
  }
  ```
  After an approved run fails for absent schema, implement migrations, casts,
  relationships and factories. Factory role states are customer/provider/admin;
  default profiles are pending; the test helper explicitly sets approved status.
  Declare explicit fillable lists for domain models; never pass raw request arrays
  to model writes. User role/demo_key are not fillable and are assigned explicitly
  by trusted account/setup code. Status and ownership fields in domain actions
  come only from server-derived, explicitly constructed arrays; no blanket unguarding. Use `$hidden` for password/remember token and no raw model
  serialization in public views.

- [ ] **5. Verify and record.**
  Run the money test and the approved schema test command, then the available
  application test suite. Record pass/fail and any approval-limited checks.
  Do not commit.

## Task 2: Registration, sessions, provider profiles and safe demo entry

**Files**
- Create: `app/Http/Controllers/Auth/{RegistrationController,SessionController,DemoSessionController}.php`.
- Create: `app/Http/Controllers/{DashboardController,ProviderProfileController}.php`.
- Create: `app/Http/Requests/{RegisterAccountRequest,LoginRequest,UpdateProviderProfileRequest}.php`.
- Create: `app/Actions/Accounts/{RegisterAccount,UpdateProviderProfile}.php`.
- Create: `app/Http/Middleware/EnsureRole.php`.
- Create: `resources/views/auth/{login,register}.blade.php`, `resources/views/professional/profile.blade.php`.
- Create: `resources/views/customer/dashboard.blade.php`, `resources/views/professional/dashboard.blade.php`.
- Modify: `routes/web.php`, `bootstrap/app.php`, `config/demo.php`.
- Tests: `tests/Feature/{AuthenticationTest,ProviderProfileTest,DemoAccessTest}.php`.

**Interfaces**
- Consumes Role, User, ProviderProfile, Category, config values and factories.
- `RegisterAccount::handle(array $validated): User` creates a customer or pending provider.
- `UpdateProviderProfile::handle(User $actor, array $validated): ProviderProfile`.
- `EnsureRole::handle(Request $request, Closure $next, string ...$roles): Response`.
- Named routes and views from the shared route contract.

- [ ] **1. Write failing HTTP tests for account creation and privileges.**
  ```php
  public function test_registration_cannot_choose_admin_privileges(): void
  {
      $this->postJson('/register', [
          'name' => 'Alex Sample', 'email' => 'alex@example.test',
          'password' => 'demo-password-123', 'password_confirmation' => 'demo-password-123',
          'account_type' => 'admin', 'role' => 'admin',
      ])->assertUnprocessable();
      $this->assertDatabaseMissing('users', ['email' => 'alex@example.test']);
  }

  public function test_customer_registration_hashes_the_password(): void
  {
      $this->post('/register', [
          'name' => 'Alex Sample', 'email' => 'alex@example.test',
          'password' => 'demo-password-123', 'password_confirmation' => 'demo-password-123',
          'account_type' => 'customer',
      ])->assertRedirect('/dashboard');
      $user = User::where('email', 'alex@example.test')->firstOrFail();
      self::assertTrue(\Illuminate\Support\Facades\Hash::check('demo-password-123', $user->password));
      $this->assertAuthenticatedAs($user);
  }
  ```
  Also assert provider registration creates one pending profile, duplicate email
  is rejected, successful login regenerates the session, logout invalidates auth,
  and a sixth failed login in one minute is throttled. Run
  `vendor/bin/phpunit tests/Feature/AuthenticationTest.php`; expected initial
  failure is the missing POST route.

- [ ] **2. Implement account/session handlers and role middleware.**
  Validate account_type in customer/provider, prohibit role/demo_key/id/status
  input, and use `['required', Password::min(10), 'confirmed']` on the password field. Validate names to 120
  characters and emails to 254; normalize emails to lowercase before uniqueness.
  Explicitly assign the server-derived role. Registration creates its pending
  provider profile in the same transaction. Use `Auth::attempt()`, session
  regeneration and `Auth::logout()`; invalidate the session and regenerate CSRF.
  Apply `throttle:5,1` to login and `throttle:10,1` to registration/demo entry.
  Role middleware aliases are registered in `bootstrap/app.php`.

- [ ] **3. Test and implement profile editing without status escalation.**
  Required profile fields: business_name 120 characters, bio 5,000, at least one
  active category and one canonical area. Limit selections to six categories and
  three areas. Slug is generated once as slug(name) plus user ID; do not accept it
  from the client. Treat status/user_id/demo_key as prohibited fields.
  ```php
  public function test_provider_cannot_approve_their_own_profile(): void
  {
      $category = Category::factory()->create();
      $provider = $this->provider($category, status: 'pending');
      $this->actingAs($provider)->putJson('/professional/profile', [
          'business_name' => 'Juniper Plumbing', 'bio' => 'Residential repairs.',
          'category_ids' => [$category->id], 'service_areas' => ['Austin'],
          'status' => 'approved',
      ])->assertUnprocessable();
      self::assertSame('pending', $provider->profile->fresh()->status->value);
  }
  ```
  Keep existing approval when editing ordinary profile text. Adding categories or
  areas remains allowed to approved providers in this demo; professional
  credential verification is not claimed. A customer cannot use this endpoint.

- [ ] **4. Test and implement demo entry.**
  ```php
  public function test_demo_entry_is_disabled_by_default(): void
  {
      config(['demo.enabled' => false]);
      $this->post('/demo/admin')->assertNotFound();
      $this->assertGuest();
  }

  public function test_demo_entry_rejects_arbitrary_ids(): void
  {
      config(['demo.enabled' => true]);
      $this->post('/demo/123')->assertNotFound();
      $this->assertGuest();
  }
  ```
  Additional tests enable demo mode, create a user with demo_key=customer,
  POST /demo/customer and assert that exact user authenticated. A non-demo user
  passed in a user_id field must not influence selection. Restrict enabled demo
  access to local/demo/testing environments. Map actor keys to allowlisted
  demo_key values; never query by client-supplied numeric IDs. Regenerate session
  after role switching. Label all entry buttons with their role.

- [ ] **5. Verify account/profile/demo suites and record results.**
  Use exact file-scoped PHPUnit commands while iterating; run the approved suite
  at the end of the task. Render functional semantic HTML forms now, with labels, errors and preserved
  values. Task 3 integrates them into the shared visual shell; account behavior
  must be independently testable before that styling step.

## Task 3: Glass shell, discovery, requests, matching and private photos

**Files**
- Create: `resources/views/components/{public-layout,app-layout,icon,field,status-badge,empty-state,flash,demo-banner}.blade.php`.
- Create: `resources/views/{home,categories/index,professionals/index,professionals/show,requests/create,requests/edit,requests/show,professional/opportunities}.blade.php`.
- Create: `app/Http/Controllers/{DiscoveryController,ServiceRequestController,RequestPhotoController,OpportunityController}.php`.
- Create: `app/Http/Requests/{StoreServiceRequestRequest,UpdateServiceRequestRequest}.php`.
- Create: `app/Actions/Requests/{CreateServiceRequest,UpdateServiceRequest}.php`.
- Create: `app/Policies/ServiceRequestPolicy.php`, `app/Queries/MatchingProviders.php`, `app/Queries/ProviderOpportunities.php`.
- Create: `app/Services/RequestPhotoStorage.php`, `app/Notifications/MarketplaceNotification.php`.
- Create: `routes/customer.php`, `routes/professional.php`.
- Modify: `resources/css/app.css`, `resources/js/app.js`, `config/filesystems.php`, `routes/web.php`, dashboard views.
- Tests: `tests/Feature/{DiscoveryTest,ServiceRequestTest,PhotoAccessTest,OpportunityTest}.php`.

**Interfaces**
- `MatchingProviders::forRequest(ServiceRequest $request): Builder` returns approved User records matching category and area.
- `ProviderOpportunities::forUser(User $provider): Builder` returns matching open ServiceRequest records.
- `RequestPhotoStorage::store(UploadedFile $file): array` returns path, mime_type, original_name, width, height.
- `RequestPhotoStorage::delete(string $path): void`.
- `CreateServiceRequest::handle(User $actor, array $validated, array $photos): ServiceRequest`.
- `UpdateServiceRequest::handle(User $actor, ServiceRequest $request, array $validated): ServiceRequest`.
- `MarketplaceNotification::__construct(string $title, string $body, string $routeName, array $routeParameters)`; database channel only, store route name/parameters rather than client URLs.
- ServiceRequestPolicy methods: view, viewPrivateDetails, create, update, cancel, quote.

- [ ] **1. Write tests for actual creation, validation and audience.**
  ```php
  public function test_customer_can_publish_a_request_with_a_private_photo(): void
  {
      \Illuminate\Support\Facades\Storage::fake('request-photos');
      $category = Category::factory()->create();
      $customer = $this->customer();
      $matching = $this->provider($category);
      $this->actingAs($customer)->post('/requests', [
          'title' => 'Repair a dripping kitchen tap', 'description' => 'The mixer leaks at the base.',
          'category_id' => $category->id, 'service_area' => 'Austin',
          'street_address' => '1842 Juniper Lane', 'preferred_date' => now()->addDays(3)->toDateString(),
          'budget' => '250.00',
          'photos' => [\Illuminate\Http\UploadedFile::fake()->image('tap.jpg', 800, 600)],
      ])->assertRedirect();
      $job = ServiceRequest::where('customer_id', $customer->id)->sole();
      self::assertSame(25000, $job->budget_cents);
      self::assertCount(1, $job->photos);
      \Illuminate\Support\Facades\Storage::disk('request-photos')->assertExists($job->photos->first()->path);
      self::assertSame(1, $matching->notifications()->count());
  }
  ```
  Add data-driven validation cases: inactive category, arbitrary service area,
  yesterday's date, title 121 characters, body 5,001 characters, negative budget,
  six photos, 5,121 KiB file, 4,097-pixel image, spoofed JPEG and SVG. Each response
  asserts its exact error key, unchanged request/photo counts and empty storage.
  Run the request tests to observe missing routes/behavior before implementation.

- [ ] **2. Implement storage, transactional creation, matching and notification.**
  Define a private `request-photos` disk at
  `storage_path('app/private/request-photos')` with exceptions enabled.
  Validate all photos before storing any. Check actual MIME and image dimensions.
  Generate random server filenames, never client paths. Store accepted images,
  create request/photo/event records and matched-provider notifications in one
  DB transaction; on any exception delete only newly written paths, then rethrow.
  To exercise partial failure, mock the storage boundary to return one recorded
  fake path and throw on the second file; assert rollback and cleanup of the first.

  Configure request validation with `image`, `mimes:jpg,jpeg,png,webp`,
  `max:5120`, and `dimensions:max_width=4096,max_height=4096`, plus explicit
  MIME validation. Add a spoofed SVG-as-PNG test so a permissive image rule alone
  cannot bypass the MIME allowlist. Limit dimensions before decoding/re-encoding.

  Updates lock the request and recheck open status and absence of quotes. Photo
  changes are not offered on the edit form in this version; existing photos remain.
  Both updating a request and submitting a quote acquire the request row so they
  cannot race through the zero-quotes check. Notify matching providers of a newly
  posted request. Matching opportunities show paginated category/area filters.

- [ ] **3. Test private details and historical access.**
  ```php
  public function test_matching_provider_cannot_see_address_before_hiring(): void
  {
      $category = Category::factory()->create();
      $job = $this->job($this->customer(), $category);
      $provider = $this->provider($category);
      $this->actingAs($provider)->get("/requests/{$job->id}")
          ->assertOk()->assertDontSee('1842 Juniper Lane');
      $this->actingAs($this->customer())->get("/requests/{$job->id}")->assertForbidden();
  }
  ```
  Photo GET tests exercise owner, eligible provider, unrelated customer,
  mismatching provider and guest. Policy view allows an owner/admin, an eligible
  matching provider while open, or a provider with a historical quote.
  viewPrivateDetails allows owner/admin/hired provider only. Never pass street
  address or customer contact to candidate HTML, hidden inputs or data attributes.
  Photo responses use verified MIME and `X-Content-Type-Options: nosniff`;
  private routes never redirect to an unrestricted public-storage URL.

- [ ] **4. Build the reusable Glass visual language and discovery screens.**
  ```css
  :root {
      --canvas: #f5f4f1; --ink: #18212b; --muted: #56616e;
      --action: #175ce5; --line: rgba(24, 33, 43, .10);
  }
  .glass-nav {
      background: rgba(255, 255, 255, .82);
      border: 1px solid rgba(255, 255, 255, .8);
      box-shadow: 0 12px 36px rgba(36, 48, 68, .08), inset 0 1px 0 #fff;
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
  }
  .content-panel { background: #fff; border: 1px solid var(--line); border-radius: 24px; }
  :focus-visible { outline: 3px solid #175ce5; outline-offset: 3px; }
  @supports not (backdrop-filter: blur(1px)) {
      .glass-nav { background: #fff; }
  }
  @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
  }
  @media (prefers-reduced-transparency: reduce) {
      .glass-nav { background: #fff; backdrop-filter: none; }
  }
  ```
  Build an original house/service illustration in `public/images/haven-home.svg`
  and category art in `public/images/services.svg`; record authorship in
  `docs/ASSETS.md`. Use system font fallbacks and local bundled fonts.
  Create a floating public navigation, editorial hero, category grid, provider
  directory with search/category/area filters, and a profile with computed rating,
  review count and service list. Do not invent "verified" badges or live-user counts.

  Signed-in layout uses a desktop sidebar and compact mobile navigation.
  Add accessible button labels, pagination, empty states, inline field errors and
  old values. JavaScript only handles menu toggles and photo previews with object
  URLs revoked when removed/replaced. Forms work without JavaScript.
  Populate dashboard counts from scoped queries, never hardcoded mock numbers.

- [ ] **5. Verify and record.**
  Run DiscoveryTest, ServiceRequestTest, PhotoAccessTest and OpportunityTest under
  approved DB-test execution; run `npm run build` and the application suite.
  Provider directory must exclude pending/suspended profiles and filter inactive
  categories out of new selections. Preserve historical category display.

## Task 4: Proposals and atomic hiring

**Files**
- Create: `app/Http/Controllers/QuoteController.php`.
- Create: `app/Http/Requests/{StoreQuoteRequest,UpdateQuoteRequest,AcceptQuoteRequest}.php`.
- Create: `app/Actions/Quotes/{SubmitQuote,UpdateQuote,AcceptQuote}.php`.
- Create: `app/Policies/QuotePolicy.php`, `app/Exceptions/WorkflowConflict.php`.
- Create: `resources/views/quotes/{form,comparison}.blade.php`, `resources/views/errors/409.blade.php`.
- Modify: `routes/professional.php`, `routes/customer.php`, `bootstrap/app.php`, request/dashboard views.
- Tests: `tests/Feature/{ProposalTest,HiringTest}.php`.

**Interfaces**
- `SubmitQuote::handle(User $actor, ServiceRequest $request, array $validated): Quote`.
- `UpdateQuote::handle(User $actor, Quote $quote, array $validated): Quote`.
- `AcceptQuote::handle(User $actor, Quote $quote, int $expectedVersion): ServiceRequest`.
- `WorkflowConflict extends RuntimeException`, rendered as 409 for HTML and JSON.
- StoreQuoteRequest validates amount/scope/date; UpdateQuoteRequest additionally
  requires an integer version >= 1; AcceptQuoteRequest requires the same version.
  Cast quote.version and money columns to integers on their models.
- Use unsigned `version` default 1 from the Task 1 quote schema; increment on pending
  edits. Acceptance form posts the displayed version. This prevents accepting a
  price changed after the comparison screen was loaded.
- QuotePolicy methods: view, update, accept. Ownership and state checks are
  distinct: wrong actor is forbidden; a stale legal actor receives a conflict.

- [ ] **1. Write proposal eligibility and immutability tests.**
  ```php
  public function test_provider_can_quote_only_an_eligible_open_request(): void
  {
      $category = Category::factory()->create();
      $job = $this->job($this->customer(), $category);
      $provider = $this->provider($category);
      $this->actingAs($provider)->post("/requests/{$job->id}/quotes", [
          'amount' => '185.50', 'scope' => 'Replace the mixer seals and test for leaks.',
          'available_date' => now()->addDays(2)->toDateString(),
      ])->assertRedirect("/requests/{$job->id}");
      $quote = $job->quotes()->sole();
      self::assertSame($provider->id, $quote->provider_id);
      self::assertSame(18550, $quote->amount_cents);
      self::assertSame(1, $quote->version);
  }
  ```
  Add separate tests for pending provider, suspended provider, mismatching category,
  mismatching area, customer role, duplicate POST, booked request, yesterday's
  availability and amount below 1 dollar. Wrong role/eligibility is 403; legal
  actor with stale job/proposal state is 409; input errors are 422.
  Assert forged provider_id/service_request_id/status fields are rejected.
  Run ProposalTest; initial failure must identify the missing behavior.

- [ ] **2. Implement proposal actions.**
  Store validates `amount` with MoneyAmount(minimum: 100), scope at 5,000
  characters, and availability against the configured date. Under a request-row
  lock, reload provider approval, category and area eligibility. Recheck open
  status and missing duplicate proposal, then create a pending quote with version
  1. Update takes the same request lock, verifies author and pending/open state,
  checks the submitted version, writes new validated values and increments version.
  Notify only the customer of a new/updated proposal. The accepted amount/scope
  are never editable.

- [ ] **3. Write acceptance and stale-version tests.**
  ```php
  public function test_acceptance_selects_one_quote_and_retries_are_idempotent(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category);
      $first = $this->quote($job, $this->provider($category));
      $second = $this->quote($job, $this->provider($category));
      $this->actingAs($customer)
          ->post("/quotes/{$first->id}/accept", ['version' => 1])->assertRedirect();
      $this->post("/quotes/{$second->id}/accept", ['version' => 1])->assertStatus(409);
      $this->post("/quotes/{$first->id}/accept", ['version' => 1])->assertRedirect();
      self::assertSame($first->id, $job->fresh()->accepted_quote_id);
      self::assertSame('booked', $job->fresh()->status->value);
      self::assertSame('declined', $second->fresh()->status->value);
      self::assertSame(1, $job->events()->where('type', 'booked')->count());
  }

  public function test_an_old_comparison_cannot_accept_a_revised_price(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category);
      $quote = $this->quote($job, $this->provider($category), ['version' => 2]);
      $this->actingAs($customer)
          ->post("/quotes/{$quote->id}/accept", ['version' => 1])->assertStatus(409);
      self::assertNull($job->fresh()->accepted_quote_id);
  }
  ```
  Add tests for another customer, a provider, a now-suspended provider's pending
  quote, and PATCH of a newly accepted quote from a stale tab. Verify no
  extra events or notifications are created by the repeated successful acceptance.

- [ ] **4. Implement atomic acceptance with compare-and-set protection.**
  ```php
  return DB::transaction(function () use ($actor, $quote, $expectedVersion) {
      $job = ServiceRequest::query()->lockForUpdate()->findOrFail($quote->service_request_id);
      $current = Quote::query()->lockForUpdate()->findOrFail($quote->id);
      Gate::forUser($actor)->authorize('accept', $current);

      if ($current->version !== $expectedVersion) {
          throw new WorkflowConflict('This proposal changed. Review its latest details.');
      }
      if ($job->accepted_quote_id === $current->id && $current->status === QuoteStatus::Accepted) {
          return $job;
      }
      if ($job->status !== JobStatus::Open || $current->status !== QuoteStatus::Pending) {
          throw new WorkflowConflict('This request already has a decision. Refresh to continue.');
      }
      if ($current->provider->profile->status !== ProviderStatus::Approved) {
          throw new WorkflowConflict('This professional is currently unavailable.');
      }

      $updated = ServiceRequest::query()->whereKey($job->id)
          ->where('status', JobStatus::Open->value)->whereNull('accepted_quote_id')
          ->update(['status' => JobStatus::Booked->value, 'accepted_quote_id' => $current->id]);

      if ($updated !== 1) {
          throw new WorkflowConflict('Another decision was saved. Refresh to continue.');
      }

      $current->update(['status' => QuoteStatus::Accepted]);
      $job->quotes()->where('id', '!=', $current->id)
          ->where('status', QuoteStatus::Pending->value)
          ->update(['status' => QuoteStatus::Declined->value]);
      $job->events()->create(['actor_id' => $actor->id, 'type' => 'booked',
          'description' => 'A professional was hired.']);
      $current->provider->notify(new MarketplaceNotification(
          'You were hired', $job->title, 'requests.show', ['serviceRequest' => $job->id]
      ));

      return $job->refresh();
  }, attempts: 3);
  ```
  Before the guarded update, also recheck category/area eligibility through the
  same matching query used for proposal submission. When notifying declined
  providers, link only to their own conversation/proposal view and never include
  the winner's price. Do not embed rival quotes in provider HTML.

  Render quote comparisons with scope, availability, exact amount and provider
  rating. Show a confirmation summary with the displayed quote version. A 409
  page provides a safe link to reload the current request and makes no mutation.

- [ ] **5. Verify proposal/hiring tests, build, suite and ledger.**
  Add a SQLite concurrency verification in Task 8 using two independent
  connections to the dedicated file test database; sequential duplicate tests
  alone are not proof of concurrency behavior.

## Task 5: Private conversations and notification inbox

**Files**
- Create: `app/Http/Controllers/{ConversationController,MessageController,NotificationController}.php`.
- Create: `app/Http/Requests/StoreMessageRequest.php`, `app/Actions/Messages/SendMessage.php`.
- Create: `app/Policies/ConversationPolicy.php`.
- Create: `resources/views/messages/{index,show}.blade.php`, `resources/views/notifications/index.blade.php`.
- Modify: `app/Providers/AppServiceProvider.php`, `routes/web.php`, layout notification counts.
- Tests: `tests/Feature/{ConversationPrivacyTest,NotificationTest}.php`.

**Interfaces**
- `ConversationPolicy::view(User $actor, Quote $quote): bool`.
- `ConversationPolicy::send(User $actor, Quote $quote): bool`.
- Register distinct Gate abilities `viewConversation` and `sendMessage` against
  these methods so QuotePolicy and conversation access cannot be confused.
- `SendMessage::handle(User $actor, Quote $quote, string $body): Message`.
- Notification records contain title/body/route_name/route_parameters; UI resolves
  only application-owned route names and escapes all displayed text.

- [ ] **1. Write privacy and stale-thread tests.**
  ```php
  public function test_provider_cannot_read_a_competitors_conversation(): void
  {
      $category = Category::factory()->create();
      $job = $this->job($this->customer(), $category);
      $first = $this->provider($category);
      $second = $this->provider($category);
      $firstQuote = $this->quote($job, $first);
      $this->quote($job, $second);
      $firstQuote->messages()->create(['sender_id' => $first->id, 'body' => 'Private scope details']);
      $this->actingAs($second)->get("/conversations/{$firstQuote->id}")->assertForbidden();
      $this->actingAs(User::factory()->admin()->create())
          ->get("/conversations/{$firstQuote->id}")->assertForbidden();
  }

  public function test_message_notifies_only_the_other_participant(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category);
      $provider = $this->provider($category);
      $quote = $this->quote($job, $provider);
      $this->actingAs($customer)->post("/conversations/{$quote->id}/messages",
          ['body' => 'Could you arrive after 10am?'])->assertRedirect();
      self::assertSame(1, $provider->notifications()->count());
      self::assertSame(0, $customer->notifications()->count());
      self::assertSame($customer->id, $quote->messages()->sole()->sender_id);
  }
  ```
  Test empty/whitespace-only messages, 2,001 characters, forged sender_id,
  HTML/script text displayed escaped, and old declined/suspended-provider threads.
  Historical participants can read; declined threads after another hire,
  completed/cancelled jobs and suspended-provider threads are read-only.
  Run both test files and observe failures before implementing.

- [ ] **2. Implement conversations without an external realtime dependency.**
  Paginate the user's own threads and messages, order by timestamp plus ID for
  stable pagination, and preserve readable timestamps. GET is read-only.
  POST validates and trims body, locks/reloads the request, checks send permission,
  stores sender from the session and creates exactly one notification for the
  other participant. Use redirect-after-POST. Closed threads show the reason that
  the composer is unavailable. Chat updates on navigation/refresh in this version;
  do not display a false live/typing indicator.

- [ ] **3. Test and implement notification ownership.**
  ```php
  public function test_user_cannot_mark_someone_elses_notification_read(): void
  {
      $owner = $this->customer();
      $other = $this->customer();
      $owner->notify(new \App\Notifications\MarketplaceNotification(
          'New activity', 'A request changed.', 'dashboard', []
      ));
      $notification = $owner->notifications()->sole();
      $this->actingAs($other)->post("/notifications/{$notification->id}/read")->assertNotFound();
      self::assertNull($notification->fresh()->read_at);
      $this->actingAs($owner)->post("/notifications/{$notification->id}/read")->assertRedirect();
      self::assertNotNull($notification->fresh()->read_at);
  }
  ```
  Resolve IDs using `$request->user()->notifications()->findOrFail($id)`,
  then mark read. Show safe links whose destinations independently enforce
  policies. Include unread badge, all/read presentation and a helpful empty state.
  Do not expose raw JSON or internal route parameters in visible copy.

- [ ] **4. Verify privacy/inbox suites, full approved suite and ledger.**

## Task 6: Job progress, cancellation, simulated payment and reviews

**Files**
- Create: `app/Actions/Jobs/{TransitionJob,CancelJob}.php`.
- Create: `app/Actions/Payments/SimulatePayment.php`, `app/Actions/Reviews/SubmitReview.php`.
- Create: `app/Http/Controllers/{JobStatusController,PaymentController,ReviewController}.php`.
- Create: `app/Http/Requests/{TransitionJobRequest,StorePaymentRequest,StoreReviewRequest}.php`.
- Create: `app/Policies/{PaymentPolicy,ReviewPolicy}.php`.
- Create: `resources/views/payments/{checkout,receipt}.blade.php`, `resources/views/reviews/form.blade.php`.
- Modify: `routes/customer.php`, `routes/professional.php`, request timelines, provider profiles and dashboards.
- Tests: `tests/Feature/{JobLifecycleTest,PaymentTest,ReviewTest}.php`.

**Interfaces**
- `TransitionJob::handle(User $actor, ServiceRequest $request, JobStatus $target): ServiceRequest`.
- `CancelJob::handle(User $actor, ServiceRequest $request): ServiceRequest`.
- `SimulatePayment::handle(User $actor, ServiceRequest $request): Payment`.
- `SubmitReview::handle(User $actor, ServiceRequest $request, int $rating, string $body): Review`.
- Payment status is always `simulated_paid`; no gateway key, card number or
  payment token exists in this application.

- [ ] **1. Write tests for the full permitted sequence and denied jumps.**
  ```php
  public function test_hired_provider_and_customer_complete_the_job_in_order(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category);
      $provider = $this->provider($category);
      $quote = $this->quote($job, $provider);
      $this->actingAs($customer)->post("/quotes/{$quote->id}/accept", ['version' => 1]);
      $this->actingAs($provider)->post("/requests/{$job->id}/status",
          ['status' => 'completed'])->assertStatus(409);
      foreach (['in_progress', 'awaiting_confirmation'] as $status) {
          $this->post("/requests/{$job->id}/status", ['status' => $status])->assertRedirect();
      }
      $this->actingAs($customer)->post("/requests/{$job->id}/status",
          ['status' => 'completed'])->assertRedirect();
      self::assertSame('completed', $job->fresh()->status->value);
  }
  ```
  Add tests for wrong customer/provider, suspended hired provider, repeated same
  transition, cancellation while open/booked, rejected cancellation in progress,
  and no duplicate event/notification on repeated transition. Repeated identical
  state submissions return the current record without another side effect.
  Invalid enum values are 422; invalid sequence for a participant is 409.

- [ ] **2. Implement the state machine under the request lock.**
  ```php
  $allowed = match ($job->status) {
      JobStatus::Booked => $isHiredProvider ? JobStatus::InProgress : null,
      JobStatus::InProgress => $isHiredProvider ? JobStatus::AwaitingConfirmation : null,
      JobStatus::AwaitingConfirmation => $isCustomer ? JobStatus::Completed : null,
      default => null,
  };

  if ($target !== $allowed) {
      throw new WorkflowConflict('This action is unavailable at the current job stage.');
  }
  ```
  Authorize participant identity first, then validate transition and provider
  approval. Persist the change, a user-facing event and the other participant's
  notification atomically. Only render event history to the customer, hired
  provider and admin; candidates see public request details and their own proposal.
  Cancellation declines outstanding pending proposals, keeps an accepted quote
  as immutable history, records an event and notifies relevant providers.
  A cancelled job has no checkout or review. Repeated cancellation is harmless.

- [ ] **3. Write payment tampering and idempotency tests.**
  Test fixture setup may directly create a completed agreement to isolate payment
  behavior; the complete transition sequence is independently tested above.
  ```php
  public function test_checkout_uses_agreed_price_and_returns_one_receipt(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category, ['status' => 'completed']);
      $quote = $this->quote($job, $this->provider($category),
          ['status' => 'accepted', 'amount_cents' => 18550]);
      $job->update(['accepted_quote_id' => $quote->id]);

      $this->actingAs($customer)->post("/requests/{$job->id}/checkout",
          ['simulation_acknowledged' => '1', 'amount_cents' => 1])->assertRedirect();
      $this->post("/requests/{$job->id}/checkout",
          ['simulation_acknowledged' => '1'])->assertRedirect();
      $payment = $job->payment()->sole();
      self::assertSame(18550, $payment->amount_cents);
      self::assertSame('simulated_paid', $payment->status);
      self::assertSame(1, \App\Models\Payment::where('service_request_id', $job->id)->count());
  }
  ```
  Assert incomplete jobs cannot pay, providers/other customers cannot pay,
  unacknowledged simulation is rejected, unauthorized receipt IDs fail, and
  receipts display "Simulated payment - no money was charged."

- [ ] **4. Implement receipt creation and checkout.**
  StorePaymentRequest validates only the simulation acknowledgement. The
  controller passes no posted price to the action. Lock the job; authorize owner;
  require completed status and an accepted quote; return its existing payment
  when present. Otherwise create one receipt with the accepted quote's cents and
  configured USD currency, a UUID receipt number and paid_at. The unique
  request/payment index is the final duplicate guard.
  Show the agreed amount and service/professional details before confirmation.
  No card, banking or identity collection fields. Provide a print stylesheet for
  a clean HTML receipt; no PDF dependency is necessary.

- [ ] **5. Write and implement completion-gated reviews.**
  ```php
  public function test_only_one_customer_review_can_be_left_after_completion(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $job = $this->job($customer, $category, ['status' => 'completed']);
      $provider = $this->provider($category);
      $quote = $this->quote($job, $provider, ['status' => 'accepted']);
      $job->update(['accepted_quote_id' => $quote->id]);
      $this->actingAs($customer)->post("/requests/{$job->id}/review",
          ['rating' => 5, 'body' => 'Clear communication and a tidy repair.'])->assertRedirect();
      $this->post("/requests/{$job->id}/review",
          ['rating' => 1, 'body' => 'Duplicate'])->assertStatus(409);
      self::assertSame($provider->id, $job->review()->sole()->provider_id);
      self::assertSame(5, $job->review()->sole()->rating);
  }
  ```
  Cover unfinished job, wrong actor, forged provider_id, rating 0/6/noninteger and
  body over 2,000 characters. Require a nonblank body, derive customer/provider
  IDs from the locked agreement and enforce the unique request index. Notify
  the provider. Use `receivedReviews()` on User for profile count/average;
  `authoredReviews()` is the customer relationship. Do not maintain a second
  manually synchronized rating field.

- [ ] **6. Verify lifecycle/payment/review suites and record results.**
  Check timeline ordering, disabled-action explanations and receipt print output
  in the later browser pass. Run the approved application suite.

## Task 7: Administration and role-specific operational dashboards

**Files**
- Create: `routes/admin.php`.
- Create: `app/Http/Controllers/Admin/{DashboardController,ProviderController,CategoryController,JobController}.php`.
- Create: `app/Http/Requests/Admin/{ChangeProviderStatusRequest,SaveCategoryRequest}.php`.
- Create: `app/Actions/Admin/{ChangeProviderStatus,SaveCategory}.php`.
- Create: `resources/views/admin/{dashboard,providers,categories,jobs}.blade.php`.
- Modify: dashboard controller/views, route imports and app navigation.
- Tests: `tests/Feature/{AdministrationTest,DashboardTest}.php`.

**Interfaces**
- `ChangeProviderStatus::handle(User $actor, ProviderProfile $profile, ProviderStatus $target): ProviderProfile`.
- `SaveCategory::handle(User $actor, array $validated, ?Category $category = null): Category`.
- All admin routes use auth plus EnsureRole(admin). Actions recheck actor role;
  middleware is not the only authorization boundary.

- [ ] **1. Write admin and protected-identity tests.**
  ```php
  public function test_customer_cannot_use_admin_routes(): void
  {
      $this->actingAs($this->customer())->get('/admin')->assertForbidden();
      $this->post('/admin/categories', ['name' => 'Roofing'])->assertForbidden();
  }

  public function test_demo_provider_identity_cannot_be_suspended(): void
  {
      $category = Category::factory()->create();
      $provider = $this->provider($category);
      $provider->forceFill(['demo_key' => 'provider'])->save();
      $admin = User::factory()->admin()->create();
      $this->actingAs($admin)->patchJson("/admin/providers/{$provider->profile->id}/status",
          ['status' => 'suspended'])->assertStatus(409);
      self::assertSame('approved', $provider->profile->fresh()->status->value);
  }
  ```
  Also test admin approval of a complete pending profile, rejection of incomplete
  approval, suspension/restoration, non-demo provider lockout from quoting and
  job transitions, and retained historical conversation/receipt reads.

- [ ] **2. Implement provider and category administration.**
  Provider transitions are pending->approved, approved->suspended and
  suspended->approved. Repeating the current status creates no duplicate notice.
  Any user with a demo_key is protected. Approval requires nonempty business name,
  bio, selected canonical area and at least one active category. Notify the
  provider of changed status.

  Category input: name 80 characters, slug generated from name on creation,
  description 500 characters, boolean is_active and an icon chosen from the six
  built-in category icon keys. A duplicate slug produces a field validation error.
  Preserve existing slug on rename. Keep historical categories and relationships;
  deactivation is reversible and never deletes requests.

- [ ] **3. Test and implement query-derived dashboards.**
  ```php
  public function test_deactivating_a_category_keeps_historical_jobs(): void
  {
      $category = Category::factory()->create();
      $job = $this->job($this->customer(), $category);
      $admin = User::factory()->admin()->create();
      $this->actingAs($admin)->patch("/admin/categories/{$category->id}", [
          'name' => $category->name, 'description' => $category->description,
          'icon' => 'plumbing', 'is_active' => false,
      ])->assertRedirect();
      self::assertFalse($category->fresh()->is_active);
      $this->assertDatabaseHas('service_requests', ['id' => $job->id, 'category_id' => $category->id]);
      $this->get("/requests/{$job->id}")->assertOk();
  }
  ```
  Customer dashboard: own open/active/completed requests, quote counts and next
  action. Provider dashboard: matching opportunities, pending proposals,
  assigned work and simulated-paid totals clearly labelled. Admin: request
  states, pending providers, active categories and simulated transaction totals.
  Test these counts against deliberately different users' records to catch
  unscoped queries. Scope job details through the existing policy; admin oversight
  does not grant private-conversation reading.

- [ ] **4. Verify admin/dashboard suites, approved full suite and ledger.**

## Task 8: Fictional fixtures, complete journey and browser verification

**Files**
- Create: `database/seeders/DemoSeeder.php`, `app/Support/DemoActors.php`.
- Modify: `database/seeders/DatabaseSeeder.php`, `config/demo.php`.
- Create: `database/demo/request-kitchen.png` (original synthetic illustration, not a copied legacy asset).
- Create: `tests/Feature/{DemoSeederTest,MarketplaceJourneyTest,HiringConcurrencyTest}.php`.
- Create: `tests/Support/ConcurrentHiring.php`, `tests/Support/hiring-worker.php`.
- Create: `README.md` replacement for the framework boilerplate, `docs/{DEMO,DEPLOYMENT,ASSETS}.md`.
- Modify: application views/styles/JS only for problems found by this verification.

**Interfaces**
- `DemoActors::keys(): array` returns exactly customer/provider/admin.
- `DemoActors::find(string $key): User` resolves only a permitted demo_key.
- `DemoSeeder::run(): void` seeds only an empty marketplace or throws before writing.
- `Tests\Support\ConcurrentHiring::prepare(string $databasePath): array` returns customer_id, request_id, first_quote_id, second_quote_id.
- `ConcurrentHiring::race(string $databasePath, array $fixture): array` returns two results with HTTP-like status 200 or 409.
- `ConcurrentHiring::inspect(string $databasePath): array` returns accepted_quote_id, accepted_count, booked_event_count.
- `ConcurrentHiring::cleanup(string $databasePath): void` removes only generated test artifacts.
- The concurrency harness runs as a PHPUnit TestCase without the Laravel
  in-memory base class; its child processes enforce their own dedicated-file
  guard before app bootstrapping.

- [ ] **1. Test non-destructive seeding before writing fixtures.**
  ```php
  public function test_setup_refuses_existing_data_without_changing_it(): void
  {
      $existing = $this->customer();
      try {
          $this->seed(\Database\Seeders\DemoSeeder::class);
          self::fail('Expected populated-database refusal.');
      } catch (\RuntimeException $exception) {
          self::assertStringContainsString('empty', $exception->getMessage());
      }
      self::assertSame(1, User::count());
      self::assertSame($existing->id, User::sole()->id);
      self::assertSame(0, Category::count());
  }

  public function test_fixtures_cover_all_roles_and_demo_stages(): void
  {
      $this->seed(\Database\Seeders\DemoSeeder::class);
      self::assertSame(6, Category::count());
      self::assertSame(8, \App\Models\ProviderProfile::count());
      self::assertSame(8, ServiceRequest::count());
      self::assertSame(['admin', 'customer', 'provider'],
          User::whereNotNull('demo_key')->orderBy('demo_key')->pluck('demo_key')->all());
      foreach (['open', 'booked', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled'] as $status) {
          self::assertTrue(ServiceRequest::where('status', $status)->exists());
      }
  }
  ```
  Also seed once, snapshot counts, call seed again and verify the refusal preserves
  counts and accepted quote/payment/review relations. Category-only preexisting
  data must refuse too. Run DemoSeederTest before adding the implementation.

- [ ] **2. Create an internally consistent fictional dataset.**
  In one transaction, first check every marketplace table for data; if any contain
  rows, throw before inserting. Do not truncate, updateOrCreate over existing
  users, reset sequences or change existing credentials.

  Exact fixture outline:

  | Record set | Contents |
  | --- | --- |
  | Demo actors | Alex Morgan/customer, Jordan Reed/provider at Juniper Home Services, Taylor Brooks/admin |
  | Other customers | Two fictional customers with example.test emails |
  | Categories | Cleaning, Plumbing, Electrical, Painting, Gardening, Handyman |
  | Provider profiles | Eight total: six approved (including Jordan), one pending, one suspended |
  | Jordan's services | Plumbing and Handyman; Austin and Round Rock |
  | Alex/open | Leaking kitchen tap, two competing quotes including Jordan |
  | Alex/in_progress | Mount hallway shelves, hired Jordan |
  | Alex/awaiting_confirmation | Rehang interior doors, hired Jordan |
  | Alex/completed | Replace bathroom mixer, hired Jordan, simulated receipt and review |
  | Alex/booked | Garden tidy-up, hired fictional gardener |
  | Alex/cancelled | Bedroom repaint, retained history and declined pending quotes |
  | Other customer/open | Repair loose cabinet hinges in Austin; available to Jordan |
  | Other customer/completed | End-of-tenancy clean, receipt and review for cleaner |

  Generate random passwords and hash them. Demo entry provides access through
  actor keys; never publish passwords or seed a fixed admin password. Use
  example.test email addresses and conspicuously fictional contact details.
  Set realistic relative dates, messages, events, notification read states and
  amounts that agree across each job, quote, receipt and aggregate.

  Create the kitchen image as an original raster illustration using GD shapes
  and label it as demo imagery in ASSETS.md; no existing property photo is copied.
  The seeder stores it privately through RequestPhotoStorage and cleans new files
  if its transaction fails. The hero/category vector illustrations remain public.
  No external image fetch is required to run setup.

- [ ] **3. Add one end-to-end HTTP workflow through actual handlers.**
  ```php
  public function test_customer_and_provider_complete_the_marketplace_journey(): void
  {
      $category = Category::factory()->create();
      $customer = $this->customer();
      $provider = $this->provider($category);
      $this->actingAs($customer)->post('/requests', [
          'title' => 'Repair kitchen tap', 'description' => 'Slow leak at the base.',
          'category_id' => $category->id, 'service_area' => 'Austin',
          'street_address' => '1842 Juniper Lane',
          'preferred_date' => now()->addDays(3)->toDateString(), 'budget' => '250',
      ])->assertRedirect();
      $job = $customer->requests()->sole();
      $this->actingAs($provider)->post("/requests/{$job->id}/quotes", [
          'amount' => '185.50', 'available_date' => now()->addDays(3)->toDateString(),
          'scope' => 'Replace seals, test and clean up.',
      ])->assertRedirect();
      $quote = $job->quotes()->sole();
      $this->actingAs($customer)->post("/conversations/{$quote->id}/messages",
          ['body' => 'Morning works for me.'])->assertRedirect();
      $this->post("/quotes/{$quote->id}/accept", ['version' => $quote->version])->assertRedirect();
      $this->actingAs($provider)->get("/requests/{$job->id}")
          ->assertOk()->assertSee('1842 Juniper Lane');
      foreach (['in_progress', 'awaiting_confirmation'] as $status) {
          $this->post("/requests/{$job->id}/status", ['status' => $status])->assertRedirect();
      }
      $this->actingAs($customer)->post("/requests/{$job->id}/status",
          ['status' => 'completed'])->assertRedirect();
      $this->post("/requests/{$job->id}/checkout",
          ['simulation_acknowledged' => '1'])->assertRedirect();
      $this->post("/requests/{$job->id}/review",
          ['rating' => 5, 'body' => 'A neat repair and clear communication.'])->assertRedirect();
      self::assertSame(18550, $job->payment()->sole()->amount_cents);
      self::assertSame($provider->id, $job->review()->sole()->provider_id);
      $this->actingAs(User::factory()->admin()->create())->get('/admin')->assertOk();
  }
  ```
  This test exercises real HTTP routes and actions; it does not seed the final
  statuses directly or mock the persistence layer.

- [ ] **4. Prove simultaneous acceptance against isolated SQLite.**
  ```php
  public function test_simultaneous_acceptance_has_exactly_one_winner(): void
  {
      $directory = dirname(__DIR__, 2).'/storage/framework/testing';
      if (! is_dir($directory)) {
          mkdir($directory, 0700, true);
      }
      $path = $directory.'/hiring-'.bin2hex(random_bytes(8)).'.sqlite';
      try {
          $fixture = \Tests\Support\ConcurrentHiring::prepare($path);
          $results = \Tests\Support\ConcurrentHiring::race($path, $fixture);
          $statuses = array_column($results, 'status');
          sort($statuses);
          self::assertSame([200, 409], $statuses);
          $state = \Tests\Support\ConcurrentHiring::inspect($path);
          self::assertSame(1, $state['accepted_count']);
          self::assertSame(1, $state['booked_event_count']);
          self::assertContains($state['accepted_quote_id'],
              [$fixture['first_quote_id'], $fixture['second_quote_id']]);
      } finally {
          \Tests\Support\ConcurrentHiring::cleanup($path);
      }
  }
  ```
  Implement cleanup as a fourth harness method
  `ConcurrentHiring::cleanup(string $databasePath): void`. It deletes only its
  exact generated database, SQLite journal/WAL/SHM files and barrier files after
  validating every path is under storage/framework/testing.

  The harness launches workers with `proc_open([PHP_BINARY, $worker, $mode,
  $databasePath, $payload], $descriptors, $pipes, dirname(__DIR__, 2),
  $isolatedEnvironment)`, without shell string interpolation. Build `$isolatedEnvironment` from `getenv()` merged with the explicit testing
  variables in Task 1 and the dedicated DB_DATABASE path. Pass that complete
  deterministic testing environment with APP_KEY, no DB_URL and no cached config.
  The worker checks the canonical file path under storage/framework/testing
  before loading bootstrap/app.php. prepare migrates that dedicated file and
  creates one request/two eligible quotes; accept calls AcceptQuote using the
  supplied actor/quote/version; inspect returns only the counts above.

  Start both accept workers, each writing a separate ready marker, then release
  a shared barrier after both are ready. Wait for the barrier before beginning
  either transaction. Apply a 5-second barrier deadline and bounded child-process
  timeout; terminate and close both processes on any failure. A WorkflowConflict
  becomes status 409; any other exception fails the test with its diagnostic.
  Never retry the entire harness until a random run passes. Test-command
  authorization must explicitly cover this isolated file and child processes.

- [ ] **5. Prepare the exact local setup commands and documentation.**
  Write the final .env example, directory permissions and SQLite path first.
  The application must resolve DB_DATABASE to this app's
  `database/haven.sqlite`. Create the empty file only if absent; never replace
  an existing file. Initial commands, each subject to the operator's rules, are:
  ```sh
  php artisan key:generate --no-interaction
  php artisan migrate --seed --no-interaction
  php artisan serve --host=127.0.0.1 --port=8091 --no-reload
  ```
  Do not hide these behind Composer scripts or a setup shell script. Describe
  expected outputs and populated-database refusal in README. Source/config files
  and tests must be ready before presenting commands for approval.

  README covers prerequisites, dependencies, configuration, setup, demo entry,
  test commands and the three-role walkthrough. DEMO.md maps all 14 Upwork
  features to their screens and explains simulated money, refresh-based messages,
  in-app-only notifications and shared demo state. DEPLOYMENT.md covers a
  public-only web root, private storage, environment flags, HTTPS, writable
  directories, fictional-only data and build assets. Do not enable real outbound
  integrations or publish the site in this task.

- [ ] **6. Run verification and use the real UI.**
  Under the applicable approvals:
  ```sh
  vendor/bin/phpunit
  vendor/bin/pint --test
  npm run build
  ```
  Run checks once after the implementation stabilizes; rerun affected checks only
  after a change/failure. Use the computer-use skill for browser operation.
  Read its instructions before interacting. Capture evidence in
  `../docs/verification/` without credentials or real personal data.

  Browser walkthrough:
  1. Public homepage, all six categories, directory filters, provider profiles.
  2. Normal customer registration, logout/login and form-error recovery.
  3. Customer demo entry; create a request with a real JPEG/PNG upload.
  4. Provider demo entry; find that request, send a quote and a message.
  5. Customer compares/accepts; provider sees private address and updates progress.
  6. Customer confirms completion, simulates payment, opens/prints receipt and reviews.
  7. Provider registers normally; admin approves it; new provider can quote.
  8. Admin category deactivation and restoration; historical jobs still render.
  9. Notification read state, old conversation links and mobile empty states.
  10. Repeat the essential flow at 390px phone width and inspect at 768px/1440px.
      Check overflow, touch targets, sidebar/menu, keyboard focus, readable glass,
      image preview removal, reduced motion and console/network errors.

  Convert functional bugs into failing regression tests before fixing them.
  Visual-only refinements need visual verification rather than implementation-
  mirroring tests. The baseline optional fontaine notice can be eliminated by
  configuring `optimizedFallbacks: false` in the existing font integration; do
  not add a dependency just to silence a cosmetic optional-feature message.

- [ ] **7. Obtain final independent review and resolve important findings.**
  Follow the chosen execution skill's final review workflow. Supply the approved
  spec, this plan, the complete new application and the ledger. The app is
  untracked initially, so a Git diff alone is insufficient; review actual files.
  Include all five Review Focus items. Reviewer is read-only, stays in this scope,
  and does not run database/Artisan commands without authorization. Fix real
  correctness/security findings with focused tests and record any remaining
  limitations accurately. Do not commit.

## Task 9: Legacy removal after standalone verification

The operator requested an explicit inventory and eventual removal of the old
source after its reference use is finished. This is a final delivery task, not
permission to delete it during planning.

**Files**
- Existing manifest: `../docs/legacy-source-inventory.json` (171 files, 7,021,418 bytes; recorded 2026-10-15).
- Create: `../docs/legacy-retirement.md`.
- Remove at the end only: `../Real-Estate/`.
- Recovery archive, ignored by Git: `../.cache/legacy-reference-2026-10-15.tar.gz`.
- Keep: all `marketplace/` source, design/plan files and the inventory.

**Interfaces**
- The JSON inventory stores each legacy path, byte size and SHA-256. It contains
  no source contents, SQL rows, passwords or other runtime data.
- Application runtime, build, setup, tests and fixtures must work without any
  dependency on the legacy directory or SQL dump.

- [ ] **1. Check independence and account for all old files.**
  ```sh
  rg -n 'Real-Estate|housing-co|indexDB\\.php|real_estate_demo/Real-Estate' app bootstrap config database resources routes public composer.json package.json vite.config.js
  ```
  Expected: no runtime/build references. Inspect asset provenance and file paths;
  textual matches alone do not prove that no asset was copied. All new imagery
  must be original or explicitly licensed and documented. No copied legacy file
  is permitted in the new app under this plan.

  Confirm Task 8 tests/browser journey are green before removal. The exact legacy
  directory must still match the saved manifest. Any new, changed, missing or
  symlinked file stops automatic cleanup for operator review; do not treat it as
  disposable merely because it is under the legacy folder.

- [ ] **2. Archive, verify and remove the exact inventoried tree.**
  Execute in WSL from the marketplace application directory after the above gates.
  Use one Python process for path validation, backup verification and deletion:
  ```python
  import hashlib
  import json
  import shutil
  import tarfile
  from pathlib import Path

  demo = Path("/var/www/demo_stuff/real_estate_demo").resolve()
  assert Path.cwd().resolve() == demo / "marketplace"
  legacy = (demo / "Real-Estate").resolve()
  assert legacy == demo / "Real-Estate" and legacy.is_dir()
  manifest = json.loads((demo / "docs/legacy-source-inventory.json").read_text())
  expected = {entry["path"]: entry["sha256"] for entry in manifest["files"]}
  actual = {}
  for path in sorted(legacy.rglob("*")):
      if path.is_symlink():
          raise RuntimeError("Legacy symlink requires review: " + str(path))
      if path.is_file():
          actual[path.relative_to(demo).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
  if actual != expected:
      raise RuntimeError("Legacy files changed; stop and review the inventory.")

  archive = (demo / ".cache/legacy-reference-2026-10-15.tar.gz").resolve()
  assert archive.is_relative_to(demo) and not archive.exists()
  archive.parent.mkdir(parents=True, exist_ok=True)
  with tarfile.open(archive, "x:gz") as bundle:
      for relative in sorted(expected):
          bundle.add(demo / relative, arcname=relative, recursive=False)
  with tarfile.open(archive, "r:gz") as bundle:
      archived = {
          item.name: hashlib.sha256(bundle.extractfile(item).read()).hexdigest()
          for item in bundle.getmembers() if item.isfile()
      }
  if archived != expected:
      raise RuntimeError("Recovery archive verification failed; leave legacy files in place.")
  assert legacy.resolve() == demo / "Real-Estate"
  shutil.rmtree(legacy)
  print("Removed only the verified legacy directory; recovery archive retained at", archive)
  ```
  This is a proposed future command, not something to execute while writing this
  plan. If the archive already exists, inspect/verify it instead of overwriting it.

- [ ] **3. Repeat the standalone checks after removal and document the result.**
  Run the approved application suite/build and reopen the homepage, profiles,
  request photos, demo entry and the job journey. Record the commands and outcome
  in legacy-retirement.md. If removal reveals a dependency, restore only the
  inventoried paths from the verified archive, fix the dependency in the new app
  and reverify before cleanup is retried. Never extract unknown archive members.

  The final report states which directory was removed, links the inventory and
  retirement record, names the ignored recovery archive, and confirms that the
  new app was verified after removal. Do not claim cleanup complete if permissions
  or unresolved checks leave the original folder in place.

## Completion checklist

- [ ] Every Upwork feature is mapped to a usable screen/flow; payment simulation is explicit.
- [ ] Customer and provider registration, ordinary login and all three demo roles work.
- [ ] Request/photo/quote/message/job/review/payment changes persist correctly.
- [ ] Policies, stale submissions, duplicate actions and concurrency checks pass.
- [ ] No plaintext credentials, real card collection, external messages or legacy dependencies.
- [ ] Glass styling is readable and navigation/forms work at phone, tablet and desktop sizes.
- [ ] Setup refuses populated databases and credentials/runtime data are excluded from Git.
- [ ] Full approved tests, frontend build, formatter and browser journey have recorded evidence.
- [ ] Independent review findings are resolved or clearly reported.
- [ ] Original reference files are inventoried, backed up, removed and followed by standalone verification.
- [ ] Source, lockfiles, instructions, limitations and review evidence are ready for the operator.
- [ ] Git has remained read-only; no other demo directories were changed.

## Execution handoff

Recommended: **Native**. The account, request, quote and permission boundaries are
tightly connected, and this application is small enough for one implementer to
maintain consistent interfaces. Implement each task in this chat, then obtain one
fresh independent review. The alternative is **Subagent-driven**, with a fresh
implementer and reviewer per task; it gives more frequent independent review at
the cost of repeated context and coordination.

The operator reviews this plan and chooses the execution approach before product
implementation begins. No additional per-feature approvals are intended; retain
the operator's specific command restrictions and ask only when those actually
apply.


## Approved operator addendum: InfinityFree public demo (2026-10-15)

Target the existing https://demo-sites.infinityfree.me/ hosting arrangement in its own subdirectory (suggested home-services-demo). Retain writable local workflows. Hosted MODE=demo (lowercase mode=demo and APP_ENV=demo accepted) blocks database mutations with a connection-level beforeExecuting hook and blocks HTTP writes before uploads. Session-only login/logout and allowlisted role switching remain available; do not rehash passwords or update remember tokens in read-only mode. All listed Upwork screens remain inspectable using seeded records at multiple workflow stages. Use file sessions/cache with a distinct Haven cookie and scoped cookie path, synchronous in-app notifications, prebuilt assets and a protected private application directory. Prepare deployment files and a MySQL schema/fixture import artifact locally; do not access the hosting database or publish without the required approval.
