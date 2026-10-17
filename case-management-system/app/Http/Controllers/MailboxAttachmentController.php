<?php

namespace App\Http\Controllers;

use App\Mailbox\AttachmentDelivery;
use App\Models\MailboxAttachment;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class MailboxAttachmentController extends Controller
{
    /**
     * @param  MailboxAttachment  $attachment
     * @param  AttachmentDelivery  $delivery
     * @return BinaryFileResponse
     *
     * @throws NotFoundHttpException
     */
    public function show(MailboxAttachment $attachment, AttachmentDelivery $delivery): BinaryFileResponse
    {
        abort_unless($attachment->mailboxMessage()->exists(), 404);
        $response = $delivery->for($attachment);

        return response()->file($response->path, ['Content-Type' => $response->contentType, ...$response->headers])
            ->setContentDisposition(
                $response->inline ? ResponseHeaderBag::DISPOSITION_INLINE : ResponseHeaderBag::DISPOSITION_ATTACHMENT,
                $attachment->filename,
            );
    }
}
