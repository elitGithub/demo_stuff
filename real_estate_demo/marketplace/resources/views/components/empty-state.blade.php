@props(['title', 'description' => '', 'icon' => 'home'])
<div class="empty-state"><span class="empty-icon"><x-icon :name="$icon" /></span><h3>{{ $title }}</h3><p>{{ $description }}</p>{{ $slot }}</div>
