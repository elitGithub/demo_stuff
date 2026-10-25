<?php

namespace App\Services;

use App\Data\ActorContext;
use App\Data\LoginInput;
use App\Data\RegistrationInput;
use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\Registry\RevokedSession;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AccountService
{
    /**
     * @param  RegistrationInput  $input
     * @return User
     */
    public function register(RegistrationInput $input): User
    {
        if (! in_array($input->role, [AccountRole::Client, AccountRole::Stylist], true)) {
            throw ValidationException::withMessages(['role' => 'Choose Client or Stylist.']);
        }

        return DB::connection('visitor')->transaction(function () use ($input): User {
            $email = mb_strtolower(trim($input->email));
            if (User::query()->where('email', $email)->exists()) {
                throw ValidationException::withMessages(['email' => 'This email is already registered in your demo.']);
            }
            $user = User::query()->create(['name' => $input->name, 'email' => $email, 'password' => Hash::make($input->password), 'role' => $input->role]);
            if ($user->hasRole(AccountRole::Stylist)) {
                $cityCode = config('demo.registration.city');
                $user->profile()->create(['display_name' => $user->name, 'city_code' => $cityCode, 'timezone' => config('demo.locations.'.$cityCode.'.timezone'), 'status' => ProfileStatus::Draft, 'deposit_percent' => config('demo.registration.deposit_percent')]);
            }
            $this->rotate($user);

            return $user;
        });
    }

    /**
     * @param  LoginInput  $input
     * @return User
     */
    public function login(LoginInput $input): User
    {
        $user = User::query()->where('email', mb_strtolower(trim($input->email)))->first();
        $supportedHash = $user !== null && Hash::info($user->password)['algoName'] === 'argon2id';
        $valid = Hash::check($input->password, $supportedHash ? $user->password : config('demo.auth.dummy_password_hash'));
        if (! $supportedHash || ! $valid) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }
        $this->rotate($user);

        return $user;
    }

    /**
     * @param  AccountRole  $role
     * @return User
     */
    public function switchRole(AccountRole $role): User
    {
        $user = User::query()->where('email', config('demo.seed_accounts.'.$role->value))->where('role', $role)->sole();
        $this->rotate($user);

        return $user;
    }

    /**
     * @return void
     */
    public function logout(): void
    {
        $this->rotate(null);
    }

    /**
     * @param  User  $actor
     * @param  string  $name
     * @return User
     */
    public function updateName(User $actor, string $name): User
    {
        $actor->update(['name' => $name]);

        return $actor;
    }

    /**
     * @param  Session  $session
     * @param  ?User  $actor
     * @return ActorContext
     */
    public function context(Session $session, ?User $actor): ActorContext
    {
        if (! $session->has('actor_revision')) {
            $session->put('actor_revision', bin2hex(random_bytes(16)));
        }

        return new ActorContext(userId: $actor?->id, revision: $session->get('actor_revision'), generation: $session->get('sandbox_generation', ''));
    }

    /**
     * @param  Session  $session
     * @param  ?User  $actor
     * @return string
     */
    public function signedContext(Session $session, ?User $actor): string
    {
        $context = $this->context($session, $actor);
        $payload = base64_encode(json_encode($context, JSON_THROW_ON_ERROR));

        return $payload.'.'.hash_hmac('sha256', $session->getId().'.'.$payload, config('app.key'));
    }

    /**
     * @param  Session  $session
     * @param  ?User  $actor
     * @param  string  $signedContext
     * @return void
     */
    public function assertContext(Session $session, ?User $actor, string $signedContext): void
    {
        if (! hash_equals($this->signedContext($session, $actor), $signedContext)) {
            throw new HttpException(409, 'Your session changed. Refresh this page.');
        }
    }

    /**
     * @param  ?User  $user
     * @return void
     */
    public function rotate(?User $user): void
    {
        $session = request()->session();
        RevokedSession::query()->create(['digest' => hash('sha256', $session->getId()), 'expires_at' => CarbonImmutable::now()->addSeconds(config('session.block_lock_seconds'))]);
        $sandbox = $session->only(['sandbox_token', 'sandbox_generation']);
        Auth::logout();
        $session->flush();
        $session->put($sandbox);
        $session->put('actor_revision', bin2hex(random_bytes(16)));
        if ($user !== null) {
            Auth::login($user);
        } else {
            $session->migrate(true);
        }
        $session->regenerateToken();
    }
}
