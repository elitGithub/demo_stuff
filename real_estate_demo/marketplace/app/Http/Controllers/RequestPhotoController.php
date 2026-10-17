<?php

namespace App\Http\Controllers;

use App\Models\RequestPhoto;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class RequestPhotoController extends Controller
{
    public function __invoke(RequestPhoto $requestPhoto): StreamedResponse
    {
        Gate::authorize('view', $requestPhoto->serviceRequest);
        abort_unless(Storage::disk('request-photos')->exists($requestPhoto->path), 404);

        return Storage::disk('request-photos')->response($requestPhoto->path, $requestPhoto->original_name, [
            'Content-Type' => $requestPhoto->mime_type,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ], 'inline');
    }
}
