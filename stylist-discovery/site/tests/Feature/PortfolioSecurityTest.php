<?php

namespace Tests\Feature;

use App\Data\PortfolioInput;
use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\PortfolioImage;
use App\Models\Registry\SandboxFile;
use App\Models\User;
use App\Services\PortfolioService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\BuildsPortfolioRuntime;
use Tests\Support\PortfolioImages;
use Tests\TestCase;

class PortfolioSecurityTest extends TestCase
{
    use BuildsPortfolioRuntime;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPortfolioRuntime();
    }

    /**
     * @return void
     */
    public function test_spoofed_animated_truncated_and_oversized_images_never_mutate_storage(): void
    {
        $png = PortfolioImages::bytes();
        $webp = PortfolioImages::bytes(format: 'webp');
        $animation = 'ANIM'.pack('V', 6).str_repeat("\0", 6);
        $animatedWebp = substr($webp, 0, 4).pack('V', strlen($webp) - 8 + strlen($animation)).substr($webp, 8).$animation;
        $inputs = [
            '<?php echo "spoof"; ?>'.PortfolioImages::bytes(format: 'jpeg'),
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            substr($png, 0, 33).PortfolioImages::pngChunk('acTL', pack('NN', 2, 0)).substr($png, 33),
            $animatedWebp,
            substr($png, 0, 33).pack('N', 4294967295).'IDAT'.substr($png, 41),
            substr($webp, 0, 16).pack('V', 4294967295).substr($webp, 20),
            substr($png, 0, -4),
            substr(PortfolioImages::bytes(format: 'jpeg'), 0, -2),
            $png.str_repeat('x', config('demo.limits.upload_bytes')),
            PortfolioImages::bytes(width: 4097, height: 1),
            PortfolioImages::bytes(width: 2001, height: 2000),
        ];
        foreach ($inputs as $input) {
            try {
                DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->store($this->portfolioActor, $this->portfolioContext, new PortfolioInput(image: $this->portfolioUpload($input, 'spoof.jpg'), caption: 'Rejected sample')));
                $this->fail('Unsafe image accepted.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('image', $exception->errors());
            }
            $this->assertSame(0, PortfolioImage::query()->count());
            $this->assertSame(0, SandboxFile::query()->count());
            $this->assertSame([], glob($this->fixtureDirectory.'/*.png'));
            $this->assertSame([], glob($this->fixtureDirectory.'/*.jpg'));
        }
    }

    /**
     * @return void
     */
    public function test_metadata_is_stripped_output_is_bounded_and_transparency_survives(): void
    {
        $png = PortfolioImages::bytes(width: 2000, height: 1000);
        $marker = 'private-location-marker';
        $png = substr($png, 0, 33).PortfolioImages::pngChunk('tEXt', 'Comment'."\0".$marker).substr($png, 33);
        $jpeg = PortfolioImages::bytes(format: 'jpeg');
        $jpeg = substr($jpeg, 0, 2)."\xff\xfe".pack('n', strlen($marker) + 2).$marker.substr($jpeg, 2);
        foreach ([$png, $jpeg, PortfolioImages::bytes(format: 'webp')] as $bytes) {
            $output = app(PortfolioService::class)->encode($this->portfolioUpload($bytes));
            $this->assertStringNotContainsString($marker, $output);
            $dimensions = getimagesizefromstring($output);
            $this->assertLessThanOrEqual(1600, max($dimensions[0], $dimensions[1]));
            $this->assertLessThanOrEqual(1048576, strlen($output));
            $this->assertContains($dimensions['mime'], ['image/png', 'image/jpeg']);
        }
        $transparent = imagecreatetruecolor(2, 2);
        imagealphablending($transparent, false);
        imagesavealpha($transparent, true);
        imagefill($transparent, 0, 0, imagecolorallocatealpha($transparent, 100, 50, 200, 127));
        ob_start();
        imagepng($transparent);
        $transparentBytes = ob_get_clean();
        imagedestroy($transparent);
        $decoded = imagecreatefromstring(app(PortfolioService::class)->encode($this->portfolioUpload($transparentBytes)));
        $this->assertSame(127, imagecolorsforindex($decoded, imagecolorat($decoded, 0, 0))['alpha']);
        imagedestroy($decoded);
    }

    /**
     * @return void
     */
    public function test_excessive_encoded_output_is_rejected_without_reservation(): void
    {
        $image = imagecreatetruecolor(800, 800);
        mt_srand(510);
        for ($row = 0; $row < 800; $row++) {
            for ($column = 0; $column < 800; $column++) {
                imagesetpixel($image, $column, $row, mt_rand(0, 16777215));
            }
        }
        ob_start();
        imagepng($image);
        $bytes = ob_get_clean();
        imagedestroy($image);
        try {
            DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->store($this->portfolioActor, $this->portfolioContext, new PortfolioInput(image: $this->portfolioUpload($bytes), caption: 'Detailed sample')));
            $this->fail('Oversized output accepted.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('too detailed', $exception->errors()['image'][0]);
        }
        $this->assertSame(0, PortfolioImage::query()->count());
        $this->assertSame(0, SandboxFile::query()->count());
    }

    /**
     * @return void
     */
    public function test_authenticated_read_visibility_forged_fields_and_cross_sandbox_collisions(): void
    {
        $form = $this->enterAccountDemo();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($form), 'role' => 'stylist'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $form = $this->get('/stylist/portfolio')->assertOk();
        $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($form), 'caption' => 'QA abstract sample', 'image' => $this->portfolioUpload(PortfolioImages::bytes())])->assertRedirect('/stylist/portfolio#save-result');
        $form = $this->get('/stylist/portfolio')->assertOk()->assertSee('QA abstract sample');
        $this->admitAccountFixture();
        $image = PortfolioImage::query()->sole();
        $this->get('/portfolio/'.$image->id)->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('Cache-Control', 'no-store, private');
        $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($form), 'caption' => 'Forged', 'storage_key' => '../../evil.php', 'image' => $this->portfolioUpload(PortfolioImages::bytes())])->assertStatus(422)->assertSee('unsupported fields');
        $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($form), 'caption' => '', 'image' => $this->portfolioUpload('<svg/>')])->assertStatus(422)->assertSee('caption-error', false);
        $this->post('/demo/role', ['_actor_context' => $this->formContext($form), 'role' => 'client'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/portfolio/'.$image->id)->assertNotFound();
        $this->admitAccountFixture();
        $image->profile->update(['status' => ProfileStatus::Published]);
        $this->get('/portfolio/'.$image->id)->assertOk();
        $clientForm = $this->get('/account')->assertOk();
        $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($clientForm), 'caption' => 'Blocked', 'image' => $this->portfolioUpload(PortfolioImages::bytes())])->assertForbidden();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($clientForm), 'role' => 'admin'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $this->admitAccountFixture();
        $image->profile->update(['status' => ProfileStatus::Suspended]);
        $this->get('/portfolio/'.$image->id)->assertOk();
        $other = $this->sandboxSession();
        $otherContext = app(SandboxService::class)->enter($other, '192.0.2.2', CarbonImmutable::now());
        $otherActor = User::query()->where('role', AccountRole::Stylist)->sole();
        $otherImage = DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->store($otherActor, $otherContext, new PortfolioInput(image: $this->portfolioUpload(PortfolioImages::bytes()), caption: 'Other sandbox')));
        $this->assertSame($image->id, $otherImage->id);
        $this->assertNotSame($image->storage_key, $otherImage->storage_key);
        try {
            DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->read($otherActor, $otherContext, $image));
            $this->fail('Foreign image object resolved by colliding numeric ID.');
        } catch (ModelNotFoundException) {
            $this->assertTrue(true);
        }
        $this->get('/portfolio/'.($image->id + 1000))->assertNotFound();
        $this->get('/portfolio/..%2Fevil')->assertNotFound();
    }
}
