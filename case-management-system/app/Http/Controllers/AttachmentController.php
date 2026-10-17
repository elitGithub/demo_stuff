<?php

namespace App\Http\Controllers;

use App\Mailbox\AttachmentDelivery;
use App\Models\Attachment;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class AttachmentController extends Controller
{
    /**
     * @param  Attachment  $attachment
     * @param  AttachmentDelivery  $delivery
     * @return BinaryFileResponse
     *
     * @throws NotFoundHttpException
     */
    public function show(Attachment $attachment, AttachmentDelivery $delivery): BinaryFileResponse
    {
        $response = $delivery->for($attachment);

        return response()
            ->file($response->path, ['Content-Type' => $response->contentType, ...$response->headers])
            ->setContentDisposition(
                $response->inline ? ResponseHeaderBag::DISPOSITION_INLINE : ResponseHeaderBag::DISPOSITION_ATTACHMENT,
                $attachment->filename,
            );
    }
}
