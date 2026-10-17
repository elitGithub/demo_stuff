<?php

namespace Tests\Unit;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Enums\ScriptEntryKind;
use App\Enums\WorkspaceLayout;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class CaseEnumsTest extends TestCase
{
    /**
     * @return array<string, array{CaseStatus, string, string, string, string}>
     */
    public static function statuses(): array
    {
        return [
            'open' => [CaseStatus::Open, 'open', 'Open', 'pill-open', 'glyph-open'],
            'in progress' => [CaseStatus::InProgress, 'in_progress', 'In progress', 'pill-progress', 'glyph-progress'],
            'closed' => [CaseStatus::Closed, 'closed', 'Closed', 'pill-closed', 'glyph-closed'],
        ];
    }

    /**
     * @param  CaseStatus  $status
     * @param  string  $value
     * @param  string  $label
     * @param  string  $pill
     * @param  string  $glyph
     * @return void
     */
    #[DataProvider('statuses')]
    public function test_case_status_values_labels_and_pills(CaseStatus $status, string $value, string $label, string $pill, string $glyph): void
    {
        $this->assertSame($value, $status->value);
        $this->assertSame($label, $status->label());
        $this->assertSame($pill, $status->pillClass());
        $this->assertSame($glyph, $status->glyphClass());
        $this->assertSame($status, CaseStatus::from($value));
    }

    /**
     * @return array<string, array{WorkspaceLayout, string}>
     */
    public static function layouts(): array
    {
        return [
            'tracker' => [WorkspaceLayout::Tracker, 'Tracker'],
            'desk' => [WorkspaceLayout::Desk, 'Conversation desk'],
            'mail' => [WorkspaceLayout::Mail, 'Mail'],
            'board' => [WorkspaceLayout::Board, 'Board'],
        ];
    }

    /**
     * @param  WorkspaceLayout  $layout
     * @param  string  $label
     * @return void
     */
    #[DataProvider('layouts')]
    public function test_workspace_layout_labels_and_cookie_round_trip(WorkspaceLayout $layout, string $label): void
    {
        $this->assertSame($label, $layout->label());
        $this->assertSame($layout, WorkspaceLayout::tryFromCookie($layout->value));
    }

    /**
     * @return void
     */
    public function test_workspace_layout_default_is_desk(): void
    {
        $this->assertSame(WorkspaceLayout::Desk, WorkspaceLayout::default());
    }

    /**
     * @return array<string, array{?string}>
     */
    public static function badCookies(): array
    {
        return [
            'null' => [null],
            'empty' => [''],
            'unknown' => ['grid'],
            'upper case' => ['DESK'],
            'padded' => [' desk'],
        ];
    }

    /**
     * @param  ?string  $value
     * @return void
     */
    #[DataProvider('badCookies')]
    public function test_workspace_layout_rejects_bad_cookie_values(?string $value): void
    {
        $this->assertNull(WorkspaceLayout::tryFromCookie($value));
    }

    /**
     * @return void
     */
    public function test_remaining_enums_have_expected_values_and_labels(): void
    {
        $this->assertSame('inbound', MessageDirection::Inbound->value);
        $this->assertSame('outbound', MessageDirection::Outbound->value);
        $this->assertSame('inbox', MailboxLabel::Inbox->value);
        $this->assertSame('sent', MailboxLabel::Sent->value);
        $this->assertSame('delivery', ScriptEntryKind::Delivery->value);
        $this->assertSame('scripted_reply', ScriptEntryKind::ScriptedReply->value);

        foreach ([...MessageDirection::cases(), ...MailboxLabel::cases(), ...ScriptEntryKind::cases(), ...CaseEventKind::cases()] as $case) {
            $this->assertNotSame('', $case->label());
        }

        $this->assertCount(5, CaseEventKind::cases());
        $this->assertSame('reply_sent', CaseEventKind::ReplySent->value);
    }
}
