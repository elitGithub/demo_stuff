<?php

namespace Tests\Support;

use App\Data\SandboxContext;
use App\Enums\AccountRole;
use App\Models\User;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;

trait BuildsPortfolioRuntime
{
    use BuildsAccountRuntime;

    protected SandboxContext $portfolioContext;

    protected User $portfolioActor;

    /**
     * @return void
     */
    protected function buildPortfolioRuntime(): void
    {
        $this->buildAccountRuntime();
        $sandbox = $this->sandboxSession();
        $this->portfolioContext = app(SandboxService::class)->enter($sandbox, '192.0.2.1', CarbonImmutable::now());
        $this->portfolioActor = User::query()->where('role', AccountRole::Stylist)->sole();
    }

    /**
     * @param  string  $bytes
     * @param  string  $name
     * @return UploadedFile
     */
    protected function portfolioUpload(string $bytes, string $name = 'sample.png'): UploadedFile
    {
        $path = $this->runtime->path(bin2hex(random_bytes(12)));
        file_put_contents($path, $bytes);

        return new UploadedFile($path, $name, 'image/png', null, true);
    }
}
