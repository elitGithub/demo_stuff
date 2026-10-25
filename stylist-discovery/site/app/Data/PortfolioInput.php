<?php

namespace App\Data;

use Illuminate\Http\UploadedFile;

readonly class PortfolioInput
{
    /**
     * @param  UploadedFile  $image
     * @param  string  $caption
     * @return void
     */
    public function __construct(public UploadedFile $image, public string $caption) {}
}
