<span {{ $attributes->class(['avatar', 'avatar-'.$tone]) }} aria-hidden="true">
    @if ($initials !== '')
        {{ $initials }}
    @else
        <x-icon name="user" />
    @endif
</span>
