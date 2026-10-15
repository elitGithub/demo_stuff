<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StudioSetting extends Model
{
    public const DEFAULTS = [
        'name' => 'Atelier',
        'hero_title' => 'Good hair. Great energy.',
        'hero_subtitle' => 'Your style, your moment. Thoughtful cuts, beautiful colour and a team that remembers the little things.',
        'about_title' => 'A little more care, every visit.',
        'about_body' => 'Our studio is a place to feel at home. We take the time to listen, remember the details and create a look that feels like you.',
        'address' => '24 Olive Street, The Creative Quarter',
        'phone' => '+1 (555) 010-2400',
        'contact_email' => 'hello@atelier.example',
        'opening_hours' => 'Monday–Saturday · 09:00–19:00',
    ];

    protected $guarded = [];
}
