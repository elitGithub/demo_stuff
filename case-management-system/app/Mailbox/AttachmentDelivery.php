<?php

namespace App\Mailbox;

use App\Data\AttachmentResponse;
use App\Models\Attachment;
use App\Models\MailboxAttachment;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

final class AttachmentDelivery
{
    private const string DOWNLOAD_TYPE = 'application/octet-stream';

    private const string SANDBOXED_POLICY = "sandbox; default-src 'none'";

    private const string PDF_POLICY = "default-src 'none'";

    private const string PDF_TYPE = 'application/pdf';

    /**
     * @param  Attachment|MailboxAttachment  $attachment
     * @return AttachmentResponse
     *
     * @throws NotFoundHttpException
     */
    public function for(Attachment|MailboxAttachment $attachment): AttachmentResponse
    {
        $path = config('casefile.attachments.directory').DIRECTORY_SEPARATOR.basename($attachment->storage_path);

        if (! is_file($path)) {
            throw new NotFoundHttpException;
        }

        $type = Str::lower(trim(Str::before($attachment->mime_type, ';')));
        $inline = in_array($type, config('casefile.attachments.inline_types'), true);
        $contentType = $inline ? $type : self::DOWNLOAD_TYPE;

        return new AttachmentResponse(
            path: $path,
            contentType: $contentType,
            inline: $inline,
            headers: [
                'X-Content-Type-Options' => 'nosniff',
                'Content-Security-Policy' => $contentType === self::PDF_TYPE ? self::PDF_POLICY : self::SANDBOXED_POLICY,
            ],
        );
    }
}
