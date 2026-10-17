@props(['status'])
<span {{ $attributes->class(['pill', $status->pillClass()]) }}>{{ $status->label() }}</span>
