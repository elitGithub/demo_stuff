<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Tests\TestCase;

class ReadOnlyDemoTest extends TestCase
{
    use RefreshDatabase;

    #[DataProvider('mutations')]
    public function test_database_hook_blocks_writes_even_when_http_middleware_is_bypassed(string $sql): void
    {
        config(['demo.read_only' => true]);

        $this->expectException(AccessDeniedHttpException::class);
        DB::unprepared($sql);
    }

    public static function mutations(): array
    {
        return [
            ['delete from users'], ["update users set name = 'Changed'"],
            ["insert into users (name,email,password) values ('Test','test@example.test','x')"],
            ['drop table users'], ['/* comment */ delete from users'],
            ['select 1; delete from users'], ['with cleared as (delete from users returning *) select * from cleared'],
            ["select * from users into outfile '/tmp/leak'"], ['/*! DELETE FROM users */'],
            ['select * from users for update'],
        ];
    }

    public function test_demo_mode_blocks_registration_before_creating_data(): void
    {
        config(['demo.read_only' => true]);

        $this->postJson('/register', [
            'name' => 'Visitor', 'email' => 'visitor@example.test', 'password' => 'demo-password',
            'password_confirmation' => 'demo-password', 'account_type' => 'customer',
        ])->assertForbidden();

        $this->assertDatabaseCount('users', 0);
    }

    public function test_demo_sessions_do_not_rehash_passwords_or_update_remember_tokens(): void
    {
        $password = Hash::make('demo-password', ['rounds' => 5]);
        $user = User::factory()->create(['remember_token' => 'existing-token']);
        DB::table('users')->where('id', $user->id)->update(['password' => $password]);
        config(['demo.read_only' => true]);

        $this->post('/login', ['email' => $user->email, 'password' => 'demo-password', 'remember' => '1'])
            ->assertRedirect('/dashboard');
        $this->assertAuthenticatedAs($user);
        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();

        self::assertSame($password, $user->fresh()->password);
        self::assertSame('existing-token', $user->fresh()->remember_token);
    }

    public function test_role_switching_still_works_with_database_writes_blocked(): void
    {
        $customer = User::factory()->customer()->create(['demo_key' => 'customer']);
        $provider = User::factory()->provider()->create(['demo_key' => 'provider']);
        config(['demo.enabled' => true, 'demo.read_only' => true]);

        $this->post('/demo/customer')->assertRedirect('/dashboard');
        $this->assertAuthenticatedAs($customer);
        $this->post('/demo/provider')->assertRedirect('/dashboard');
        $this->assertAuthenticatedAs($provider);
    }

    public function test_reads_and_non_demo_writes_still_work(): void
    {
        $user = User::factory()->create();
        config(['demo.read_only' => true]);
        self::assertSame($user->id, User::whereKey($user->id)->sole()->id);
        config(['demo.read_only' => false]);

        $user->update(['name' => 'Changed locally']);
        self::assertSame('Changed locally', $user->fresh()->name);
    }
}
