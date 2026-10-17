<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class ConversationPrivacyTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_competitors_and_admin_cannot_read_private_conversations(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $first = $this->provider($category);
        $second = $this->provider($category);
        $quote = $this->quote($job, $first);
        $this->quote($job, $second);
        $quote->messages()->create(['sender_id' => $first->id, 'body' => 'Private scope details']);

        $this->actingAs($second)->get("/conversations/{$quote->id}")->assertForbidden();
        $this->actingAs(User::factory()->admin()->create())->get("/conversations/{$quote->id}")->assertForbidden();
    }

    public function test_message_notifies_only_the_other_participant_and_escapes_content(): void
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $job = $this->job($customer, $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);

        $this->actingAs($customer)->post("/conversations/{$quote->id}/messages", [
            'body' => '  Could you arrive after 10? <script>alert("x")</script>  ',
        ])->assertRedirect("/conversations/{$quote->id}");

        self::assertSame(1, $provider->notifications()->count());
        self::assertSame(0, $customer->notifications()->count());
        self::assertSame($customer->id, $quote->messages()->sole()->sender_id);
        self::assertSame('Could you arrive after 10? <script>alert("x")</script>', $quote->messages()->sole()->body);
        $this->get("/conversations/{$quote->id}")->assertOk()
            ->assertSee('&lt;script&gt;', false)->assertDontSee('<script>alert("x")</script>', false);
    }

    #[DataProvider('invalidMessages')]
    public function test_invalid_messages_do_not_send_notifications(string $body, array $extra, string $error): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $quote = $this->quote($job, $this->provider($category));

        $this->actingAs($owner)->postJson("/conversations/{$quote->id}/messages", array_merge(['body' => $body], $extra))
            ->assertUnprocessable()->assertJsonValidationErrors($error);
        $this->assertDatabaseCount('messages', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public static function invalidMessages(): array
    {
        return [['', [], 'body'], ['   ', [], 'body'], [str_repeat('x', 2001), [], 'body'],
            ['Hello', ['sender_id' => 999], 'sender_id']];
    }

    #[DataProvider('closedThreads')]
    public function test_historical_threads_remain_readable_but_cannot_receive_messages(string $jobStatus, string $quoteStatus, string $providerStatus): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category, ['status' => $jobStatus]);
        $provider = $this->provider($category, status: $providerStatus);
        $quote = $this->quote($job, $provider, ['status' => $quoteStatus]);
        $quote->messages()->create(['sender_id' => $owner->id, 'body' => 'Our earlier discussion']);

        $this->actingAs($owner)->get("/conversations/{$quote->id}")->assertOk()->assertSee('Our earlier discussion');
        $this->postJson("/conversations/{$quote->id}/messages", ['body' => 'A new message'])->assertForbidden();
        $this->actingAs($provider)->get("/conversations/{$quote->id}")->assertOk()->assertSee('Our earlier discussion');
        $this->postJson("/conversations/{$quote->id}/messages", ['body' => 'A new message'])->assertForbidden();
        $this->assertDatabaseCount('messages', 1);
    }

    public static function closedThreads(): array
    {
        return [['booked', 'declined', 'approved'], ['completed', 'accepted', 'approved'],
            ['cancelled', 'pending', 'approved'], ['open', 'pending', 'suspended']];
    }

    public function test_inbox_does_not_list_other_customers_threads(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $provider = $this->provider($category);
        $mine = $this->job($owner, $category, ['title' => 'My conversation']);
        $this->quote($mine, $provider);
        $other = $this->job($this->customer(), $category, ['title' => 'A private other conversation']);
        $this->quote($other, $provider);

        $this->actingAs($owner)->get('/messages')->assertOk()->assertSee('My conversation')
            ->assertDontSee('A private other conversation');
    }
}
