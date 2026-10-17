<?php

namespace App\View\Components;

use Illuminate\Contracts\View\View;
use Illuminate\Support\Str;
use Illuminate\View\Component;

class Avatar extends Component
{
    private const array TONES = ['peach', 'lavender', 'sage', 'sky'];

    public string $initials;

    public string $tone;

    /**
     * @param  string  $name
     */
    public function __construct(
        public string $name,
    ) {
        $this->initials = Str::of($name)
            ->squish()
            ->explode(' ')
            ->filter(fn (string $word): bool => preg_match('/^\p{L}/u', $word) === 1)
            ->take(2)
            ->map(fn (string $word): string => mb_strtoupper(mb_substr($word, 0, 1)))
            ->implode('');
        $this->tone = self::TONES[crc32(mb_strtolower($name)) % count(self::TONES)];
    }

    /**
     * @return View
     */
    public function render(): View
    {
        return view('components.avatar');
    }
}
