<?php

namespace App\Contracts;

use App\Data\MailboxPull;
use App\Data\OutgoingReply;
use App\Data\SentReply;
use App\Support\SenderAddress;

interface MailboxConnector
{
    /**
     * @param  ?string  $cursor
     * @return MailboxPull
     */
    public function pull(?string $cursor): MailboxPull;

    /**
     * @param  SenderAddress  $sender
     * @return MailboxPull
     */
    public function backfill(SenderAddress $sender): MailboxPull;

    /**
     * @param  OutgoingReply  $reply
     * @return SentReply
     */
    public function send(OutgoingReply $reply): SentReply;
}
